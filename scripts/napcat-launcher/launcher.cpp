// QCE Linux launcher shim — LD_PRELOAD hook that lets QCE boot inside the
// real QQ Electron process instead of a vanilla Node.js process.
//
// Why this exists (issue #433):
//
//   The previous launcher-user.sh ran `node napcat-bootstrap.mjs`, then loaded
//   napcat.mjs (and through it, QQ's wrapper.node) into a plain Node.js
//   process. wrapper.node is a Chromium/Electron native addon — it assumes
//   the embedder set up V8 isolates and the libstdc++ runtime the way
//   Electron does. When loaded into stock Node, the C++ STL state inside the
//   addon ends up half-initialised; the first vector<string>::_M_realloc_insert
//   after `session.startNT()` reads a corrupted _M_start and crashes:
//
//     #0  0x...x in std::vector<std::string>::_M_realloc_insert<...>
//             at /opt/QQ/resources/app/wrapper.node
//     #1  0x0
//
//   That is the segfault users on Fedora 44 / Debian 13 / Arch / Ubuntu
//   24.04 / NixOS see immediately after the QR-code login completes.
//
// The fix:
//
//   Run the actual /opt/QQ/qq binary (Electron) and use LD_PRELOAD to swap
//   QQ's package.json `main` to point at our loadNapCat.js, which in turn
//   imports napcat.mjs from the QCE pack directory. wrapper.node now loads
//   inside the Electron embedder it was built for, the vector layout matches,
//   and login completes cleanly.
//
//   This is a direct port of the LD_PRELOAD shim NapNeko/napcat-linux-launcher
//   uses (https://github.com/NapNeko/napcat-linux-launcher), with three
//   QCE-specific changes:
//
//     1. NAPCAT_JS_CONTENT imports `./napcat.mjs` (QCE pack layout) instead
//        of `./napcat/napcat.mjs` (NapCat-only layout).
//     2. The path of QQ's package.json is overridable via the
//        NAPCAT_QQ_PKG_JSON env var (set by launcher-user.sh from the
//        auto-detected QQ install).
//     3. Logging is gated behind the NAPCAT_LAUNCHER_DEBUG env var so the
//        normal stdout stays clean.
//
// Build:
//   g++ -shared -fPIC -O2 -o libnapcat_launcher.so launcher.cpp -ldl
//
// Use:
//   LD_PRELOAD=./libnapcat_launcher.so \
//     NAPCAT_BOOTMAIN=/path/to/NapCat-QCE-Linux-x64 \
//     NAPCAT_QQ_PKG_JSON=/opt/QQ/resources/app/package.json \
//     /opt/QQ/qq --no-sandbox
//
// Licensed under GPL-3.0, matching the QCE main repository.

#include <dlfcn.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <stdio.h>
#include <errno.h>
#include <stdlib.h>
#include <stdarg.h>
#include <stdbool.h>
#include <limits.h>
#include <libgen.h>

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Path patterns we hook. We match by suffix so that both relative
// ("resources/app/package.json") and absolute ("/opt/QQ/resources/app/...")
// lookups are caught; QQ's Electron uses both depending on the syscall path.
static const char *TARGET_PACKAGE_JSON = "resources/app/package.json";
static const char *TARGET_NAPCAT_JS = "resources/app/loadNapCat.js";

// Default fallback if NAPCAT_QQ_PKG_JSON is unset. Linux QQ deb installs
// land here; snap/flatpak/portable installs override via the env var.
static const char *DEFAULT_PACKAGE_JSON = "/opt/QQ/resources/app/package.json";

// The drop-in `main` field we look for in QQ's package.json. We try the
// asar-packed form first (current QQNT) and the unpacked form second
// (older installs and some semi-auto setups).
static const char *ORIGINAL_MAIN_ASAR =
    "\"main\": \"./application.asar/app_launcher/index.js\"";
static const char *ORIGINAL_MAIN_PLAIN =
    "\"main\": \"./application/app_launcher/index.js\"";

// JS injected as the new entry point. NAPCAT_BOOTMAIN is exported by
// launcher-user.sh and points at the QCE pack directory, where napcat.mjs
// lives alongside the bundled NapCat runtime. We deliberately do NOT chain
// through napcat-bootstrap.mjs: the bootstrap only existed to monkey-patch
// process.execPath when running under plain Node, and under real Electron
// process.execPath already points at the QQ binary.
static const char *NAPCAT_JS_CONTENT =
    "const path = require('path');"
    "const CurrentPath = process.env.NAPCAT_BOOTMAIN || path.dirname(__filename);"
    "(async () => {"
    "  await import('file://' + path.join(CurrentPath, './napcat.mjs'));"
    "})();";

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

// Caches the patched package.json so we don't re-read+re-allocate on every
// hooked open(). Electron typically opens it via both `open64` and `fopen64`.
static char *g_modified_package_json = nullptr;
static char g_new_main[PATH_MAX + 128] = {0};
static bool g_loadnapcat_disk_generated = false;

static const char *qq_pkg_json_path()
{
    const char *p = getenv("NAPCAT_QQ_PKG_JSON");
    if (p && *p)
        return p;
    return DEFAULT_PACKAGE_JSON;
}

static bool launcher_debug()
{
    static int cached = -1;
    if (cached == -1)
    {
        const char *v = getenv("NAPCAT_LAUNCHER_DEBUG");
        cached = (v && *v && strcmp(v, "0") != 0) ? 1 : 0;
    }
    return cached != 0;
}

#define LAUNCHER_LOG(...)                              \
    do                                                 \
    {                                                  \
        if (launcher_debug())                          \
        {                                              \
            fprintf(stderr, "[napcat-launcher] " __VA_ARGS__); \
            fputc('\n', stderr);                       \
        }                                              \
    } while (0)

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

// True if `path` ends in `target` or equals it. Used so we match QQ's
// package.json regardless of how Electron spelled the lookup.
static bool path_matches(const char *path, const char *target)
{
    if (!path || !target)
        return false;
    size_t path_len = strlen(path);
    size_t target_len = strlen(target);
    if (path_len < target_len)
        return false;
    return strcmp(path, target) == 0 ||
           strcmp(path + path_len - target_len, target) == 0;
}

// Build a POSIX relative path from `from_dir` to `to_dir`. Used to rewrite
// QQ's `main` field so QQ Electron can load loadNapCat.js out of the QCE
// pack directory regardless of where the user extracted it.
static int get_relative_path(const char *from_dir, const char *to_dir,
                             char *out, size_t out_size)
{
    char from[PATH_MAX], to[PATH_MAX];

    if (!realpath(from_dir, from) || !realpath(to_dir, to))
        return -1;

    size_t from_len = strlen(from);
    size_t to_len = strlen(to);

    if (from_len + 2 >= PATH_MAX || to_len + 2 >= PATH_MAX)
        return -1;

    if (from[from_len - 1] != '/')
    {
        from[from_len++] = '/';
        from[from_len] = '\0';
    }
    if (to[to_len - 1] != '/')
    {
        to[to_len++] = '/';
        to[to_len] = '\0';
    }

    // Longest common prefix, snapped back to a path component boundary.
    size_t common_len = 0;
    while (common_len < from_len && common_len < to_len &&
           from[common_len] == to[common_len])
        common_len++;
    while (common_len > 0 && from[common_len - 1] != '/')
        common_len--;

    size_t up_levels = 0;
    for (size_t i = common_len; i < from_len; i++)
        if (from[i] == '/')
            up_levels++;

    char result[PATH_MAX] = {0};
    for (size_t i = 0; i < up_levels; i++)
    {
        if (strlen(result) + 3 >= sizeof(result))
            return -1;
        strcat(result, "../");
    }
    if (common_len < to_len)
    {
        if (strlen(result) + (to_len - common_len) >= sizeof(result))
            return -1;
        strcat(result, to + common_len);
    }
    // Drop a trailing '/' so we don't synthesise `../../..//loadNapCat.js`
    // when concatenating below. Works for both the ".." chain only case and
    // the chain + suffix case.
    {
        size_t rl = strlen(result);
        if (rl > 1 && result[rl - 1] == '/')
            result[rl - 1] = '\0';
    }
    if (strlen(result) == 0)
        strcpy(result, ".");

    strncpy(out, result, out_size - 1);
    out[out_size - 1] = '\0';
    return 0;
}

// ---------------------------------------------------------------------------
// package.json patching
// ---------------------------------------------------------------------------

static char *get_modified_packagejson()
{
    if (g_modified_package_json)
        return g_modified_package_json;

    // Use the libc fopen directly so we don't recurse into our own hook.
    static FILE *(*real_fopen)(const char *, const char *) = nullptr;
    if (!real_fopen)
    {
        real_fopen = (FILE * (*)(const char *, const char *))
            dlsym(RTLD_NEXT, "fopen");
        if (!real_fopen)
            return nullptr;
    }

    const char *pkg_path = qq_pkg_json_path();
    FILE *fp = real_fopen(pkg_path, "r");
    if (!fp)
    {
        LAUNCHER_LOG("could not open %s: %s", pkg_path, strerror(errno));
        return nullptr;
    }

    fseek(fp, 0, SEEK_END);
    long file_size = ftell(fp);
    fseek(fp, 0, SEEK_SET);
    if (file_size <= 0)
    {
        fclose(fp);
        return nullptr;
    }

    char *buffer = (char *)malloc(file_size + 1);
    if (!buffer)
    {
        fclose(fp);
        return nullptr;
    }
    size_t bytes_read = fread(buffer, 1, file_size, fp);
    buffer[bytes_read] = 0;
    fclose(fp);

    // Try both the asar form and the plain form. If neither matches we hand
    // back the buffer unmodified — Electron still loads it, just into the
    // un-patched main, which lets users debug what went wrong instead of
    // getting a hard-to-diagnose "package.json not found" failure.
    const char *match = ORIGINAL_MAIN_ASAR;
    char *main_pos = strstr(buffer, ORIGINAL_MAIN_ASAR);
    if (!main_pos)
    {
        main_pos = strstr(buffer, ORIGINAL_MAIN_PLAIN);
        match = ORIGINAL_MAIN_PLAIN;
    }
    if (!main_pos)
    {
        LAUNCHER_LOG("no known main entry in %s; passing through unmodified",
                     pkg_path);
        g_modified_package_json = buffer;
        return buffer;
    }

    // Compute the path from package.json's directory to CWD (= QCE pack dir).
    char pkg_dir[PATH_MAX], cwd[PATH_MAX], relpath[PATH_MAX];
    strncpy(pkg_dir, pkg_path, PATH_MAX - 1);
    pkg_dir[PATH_MAX - 1] = '\0';
    char *last_slash = strrchr(pkg_dir, '/');
    if (last_slash)
        *last_slash = '\0';

    if (!getcwd(cwd, sizeof(cwd)))
    {
        LAUNCHER_LOG("getcwd failed: %s", strerror(errno));
        free(buffer);
        return nullptr;
    }
    if (get_relative_path(pkg_dir, cwd, relpath, sizeof(relpath)) != 0)
    {
        LAUNCHER_LOG("get_relative_path(%s -> %s) failed", pkg_dir, cwd);
        free(buffer);
        return nullptr;
    }

    snprintf(g_new_main, sizeof(g_new_main),
             "\"main\": \"%s/loadNapCat.js\"", relpath);

    size_t prefix_size = main_pos - buffer;
    size_t new_main_len = strlen(g_new_main);
    size_t suffix_size = strlen(main_pos + strlen(match));
    size_t new_size = prefix_size + new_main_len + suffix_size;

    char *modified = (char *)malloc(new_size + 1);
    if (!modified)
    {
        free(buffer);
        return nullptr;
    }
    memcpy(modified, buffer, prefix_size);
    memcpy(modified + prefix_size, g_new_main, new_main_len);
    memcpy(modified + prefix_size + new_main_len,
           main_pos + strlen(match), suffix_size);
    modified[new_size] = 0;

    free(buffer);
    g_modified_package_json = modified;

    LAUNCHER_LOG("relative path: %s", relpath);
    LAUNCHER_LOG("new main field: %s", g_new_main);
    return g_modified_package_json;
}

// ---------------------------------------------------------------------------
// memfd-backed virtual file
// ---------------------------------------------------------------------------

static int create_memfd_with_content(const char *content)
{
    if (!content)
        return -1;
    int fd = syscall(SYS_memfd_create, "napcat_memfd", 0);
    if (fd < 0)
        return -1;
    size_t len = strlen(content);
    if (write(fd, content, len) != (ssize_t)len ||
        lseek(fd, 0, SEEK_SET) == -1)
    {
        close(fd);
        return -1;
    }
    return fd;
}

// Drop a real loadNapCat.js next to the launcher on disk as a fallback for
// QQ versions that read it via syscalls we don't hook (e.g. mmap, statx).
// This runs once when the .so is loaded — i.e. before QQ's main(), so CWD
// is still the QCE pack directory.
__attribute__((constructor))
static void generate_loadnapcat_disk_fallback()
{
    if (g_loadnapcat_disk_generated)
        return;
    FILE *fp = fopen("loadNapCat.js", "w");
    if (!fp)
        return;
    fwrite(NAPCAT_JS_CONTENT, 1, strlen(NAPCAT_JS_CONTENT), fp);
    fclose(fp);
    g_loadnapcat_disk_generated = true;
    LAUNCHER_LOG("disk fallback loadNapCat.js written to CWD");
}

// ---------------------------------------------------------------------------
// open()/fopen() hooks
// ---------------------------------------------------------------------------

static int handle_target_file(const char *pathname)
{
    if (path_matches(pathname, TARGET_PACKAGE_JSON))
    {
        char *content = get_modified_packagejson();
        if (!content)
        {
            errno = ENOENT;
            return -1;
        }
        LAUNCHER_LOG("intercepted package.json: %s", pathname);
        return create_memfd_with_content(content);
    }
    if (path_matches(pathname, TARGET_NAPCAT_JS))
    {
        LAUNCHER_LOG("intercepted loadNapCat.js: %s", pathname);
        return create_memfd_with_content(NAPCAT_JS_CONTENT);
    }
    return -1;
}

// Different processes reach the package.json through different libc entry
// points: QQ Electron on Debian/Ubuntu uses `open64`/`fopen64`, NixOS and
// musl-flavoured glibcs use `openat`, and coreutils `cat` (which we use in
// our unit tests) goes through `openat` exclusively. Hook the union.

extern "C" int open64(const char *pathname, int flags, ...)
{
    static int (*real_open64)(const char *, int, ...) = nullptr;
    if (!real_open64)
    {
        real_open64 = (int (*)(const char *, int, ...))
            dlsym(RTLD_NEXT, "open64");
        if (!real_open64)
            return -1;
    }

    int target_fd = handle_target_file(pathname);
    if (target_fd >= 0)
        return target_fd;

    va_list args;
    va_start(args, flags);
    int result;
    if (flags & O_CREAT)
    {
        int mode = va_arg(args, int);
        result = real_open64(pathname, flags, mode);
    }
    else
    {
        result = real_open64(pathname, flags);
    }
    va_end(args);
    return result;
}

extern "C" int open(const char *pathname, int flags, ...)
{
    static int (*real_open)(const char *, int, ...) = nullptr;
    if (!real_open)
    {
        real_open = (int (*)(const char *, int, ...))
            dlsym(RTLD_NEXT, "open");
        if (!real_open)
            return -1;
    }

    int target_fd = handle_target_file(pathname);
    if (target_fd >= 0)
        return target_fd;

    va_list args;
    va_start(args, flags);
    int result;
    if (flags & O_CREAT)
    {
        int mode = va_arg(args, int);
        result = real_open(pathname, flags, mode);
    }
    else
    {
        result = real_open(pathname, flags);
    }
    va_end(args);
    return result;
}

extern "C" int openat(int dirfd, const char *pathname, int flags, ...)
{
    static int (*real_openat)(int, const char *, int, ...) = nullptr;
    if (!real_openat)
    {
        real_openat = (int (*)(int, const char *, int, ...))
            dlsym(RTLD_NEXT, "openat");
        if (!real_openat)
            return -1;
    }

    // Only intercept absolute paths — relative-to-dirfd lookups against
    // arbitrary parent directories are rare in practice (Electron always
    // hands us absolute paths) and trying to resolve them here would be
    // fragile.
    if (pathname && pathname[0] == '/')
    {
        int target_fd = handle_target_file(pathname);
        if (target_fd >= 0)
            return target_fd;
    }

    va_list args;
    va_start(args, flags);
    int result;
    if (flags & O_CREAT)
    {
        int mode = va_arg(args, int);
        result = real_openat(dirfd, pathname, flags, mode);
    }
    else
    {
        result = real_openat(dirfd, pathname, flags);
    }
    va_end(args);
    return result;
}

extern "C" FILE *fopen64(const char *pathname, const char *mode)
{
    int target_fd = handle_target_file(pathname);
    if (target_fd >= 0)
    {
        FILE *fp = fdopen(target_fd, mode);
        if (!fp)
            close(target_fd);
        return fp;
    }
    static FILE *(*real_fopen64)(const char *, const char *) = nullptr;
    if (!real_fopen64)
    {
        real_fopen64 = (FILE * (*)(const char *, const char *))
            dlsym(RTLD_NEXT, "fopen64");
        if (!real_fopen64)
            return nullptr;
    }
    return real_fopen64(pathname, mode);
}

extern "C" FILE *fopen(const char *pathname, const char *mode)
{
    int target_fd = handle_target_file(pathname);
    if (target_fd >= 0)
    {
        FILE *fp = fdopen(target_fd, mode);
        if (!fp)
            close(target_fd);
        return fp;
    }
    static FILE *(*real_fopen)(const char *, const char *) = nullptr;
    if (!real_fopen)
    {
        real_fopen = (FILE * (*)(const char *, const char *))
            dlsym(RTLD_NEXT, "fopen");
        if (!real_fopen)
            return nullptr;
    }
    return real_fopen(pathname, mode);
}
