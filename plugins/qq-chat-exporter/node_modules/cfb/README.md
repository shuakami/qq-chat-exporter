# Container File Blobs

Pure JS implementation of various container file formats, including ZIP and CFB.

[![Build Status](https://travis-ci.org/SheetJS/js-cfb.svg?branch=master)](https://travis-ci.org/SheetJS/js-cfb)
[![Coverage Status](http://img.shields.io/coveralls/SheetJS/js-cfb/master.svg)](https://coveralls.io/r/SheetJS/js-cfb?branch=master)
[![Dependencies Status](https://david-dm.org/sheetjs/js-cfb/status.svg)](https://david-dm.org/sheetjs/js-cfb)
[![NPM Downloads](https://img.shields.io/npm/dt/cfb.svg)](https://npmjs.org/package/cfb)
[![Analytics](https://ga-beacon.appspot.com/UA-36810333-1/SheetJS/js-cfb?pixel)](https://github.com/SheetJS/js-cfb)

## Installation

In the browser:

```html
<script src="dist/cfb.min.js" type="text/javascript"></script>
```

With [npm](https://www.npmjs.org/package/cfb):

```bash
$ npm install cfb
```

The `xlscfb.js` file is designed to be embedded in [js-xlsx](http://git.io/xlsx)


## Library Usage

In node:

```js
var CFB = require('cfb');
```

For example, to get the Workbook content from an Excel 2003 XLS file:

```js
var cfb = CFB.read(filename, {type: 'file'});
var workbook = CFB.find(cfb, 'Workbook');
var data = workbook.content;
```


## Command-Line Utility Usage

The [`cfb-cli`](https://www.npmjs.com/package/cfb-cli) module ships with a CLI
tool for manipulating and inspecting supported files.


## JS API

TypeScript definitions are maintained in `types/index.d.ts`.

The CFB object exposes the following methods and properties:

`CFB.parse(blob)` takes a nodejs Buffer or an array of bytes and returns an
parsed representation of the data.

`CFB.read(blob, opts)` wraps `parse`.

`CFB.find(cfb, path)` performs a case-insensitive match for the path (or file
name, if there are no slashes) and returns an entry object or null if not found.

`CFB.write(cfb, opts)` generates a file based on the container.

`CFB.writeFile(cfb, filename, opts)` creates a file with the specified name.

### Parse Options

`CFB.read` takes an options argument.  `opts.type` controls the behavior:

| `type`     | expected input                                                  |
|------------|:----------------------------------------------------------------|
| `"base64"` | string: Base64 encoding of the file                             |
| `"binary"` | string: binary string (byte `n` is `data.charCodeAt(n)`)        |
| `"buffer"` | nodejs Buffer                                                   |
| `"file"`   | string: path of file that will be read (nodejs only)            |
| (default)  | buffer or array of 8-bit unsigned int (byte `n` is `data[n]`)   |


### Write Options

`CFB.write` and `CFB.writeFile` take options argument.

`opts.type` controls the behavior:

| `type`     | output                                                          |
|------------|:----------------------------------------------------------------|
| `"base64"` | string: Base64 encoding of the file                             |
| `"binary"` | string: binary string (byte `n` is `data.charCodeAt(n)`)        |
| `"buffer"` | nodejs Buffer                                                   |
| `"file"`   | string: path of file that will be created (nodejs only)         |
| (default)  | buffer if available, array of 8-bit unsigned int otherwise      |

`opts.fileType` controls the output file type:

| `fileType`         | output                  |
|:-------------------|:------------------------|
| `'cfb'` (default)  | CFB container           |
| `'zip'`            | ZIP file                |
| `'mad'`            | MIME aggregate document |

`opts.compression` enables DEFLATE compression for ZIP file type.


## Utility Functions

The utility functions are available in the `CFB.utils` object.  Functions that
accept a `name` argument strictly deal with absolute file names:

- `.cfb_new(?opts)` creates a new container object.
- `.cfb_add(cfb, name, ?content, ?opts)` adds a new file to the `cfb`.
  Set the option `{unsafe:true}` to skip existence checks (for bulk additions)
- `.cfb_del(cfb, name)` deletes the specified file
- `.cfb_mov(cfb, old_name, new_name)` moves the old file to new path and name
- `.use_zlib(require("zlib"))` loads a nodejs `zlib` instance.

By default, the library uses a pure JS inflate/deflate implementation.  NodeJS
`zlib.InflateRaw` exposes the number of bytes read in versions after `8.11.0`.
If a supplied `zlib` does not support the required features, a warning will be
displayed in the console and the pure JS fallback will be used.


## Container Object Description

The objects returned by `parse` and `read` have the following properties:

- `.FullPaths` is an array of the names of all of the streams (files) and
  storages (directories) in the container.  The paths are properly prefixed from
  the root entry (so the entries are unique)

- `.FileIndex` is an array, in the same order as `.FullPaths`, whose values are
  objects following the schema:

```typescript
interface CFBEntry {
  name: string; /** Case-sensitive internal name */
  type: number; /** 1 = dir, 2 = file, 5 = root ; see [MS-CFB] 2.6.1 */
  content: Buffer | number[] | Uint8Array; /** Raw Content */
  ct?: Date; /** Creation Time */
  mt?: Date; /** Modification Time */
  ctype?: String; /** Content-Type (for MAD) */
}
```


## License

Please consult the attached LICENSE file for details.  All rights not explicitly
granted by the Apache 2.0 License are reserved by the Original Author.


## References

 - `MS-CFB`: Compound File Binary File Format
 - ZIP `APPNOTE.TXT`: .ZIP File Format Specification
 - RFC1951: https://www.ietf.org/rfc/rfc1951.txt
 - RFC2045: https://www.ietf.org/rfc/rfc2045.txt
 - RFC2557: https://www.ietf.org/rfc/rfc2557.txt

