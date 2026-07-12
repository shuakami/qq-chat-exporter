fn main() {
    // Explicit trustInfo (asInvoker) in the manifest: executables whose file
    // name contains "installer"/"setup" and that lack a requestedExecutionLevel
    // are subject to Windows UAC installer-detection heuristics when launched
    // from Explorer (double-click goes through ShellExecute/AIS), which can
    // silently swallow the launch. Launching from a terminal (CreateProcess)
    // bypasses the heuristic, which is why the exe worked from PowerShell only.
    let windows = tauri_build::WindowsAttributes::new().app_manifest(
        r#"<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <longPathAware xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">true</longPathAware>
    </windowsSettings>
  </application>
</assembly>"#,
    );
    tauri_build::try_build(tauri_build::Attributes::new().windows_attributes(windows))
        .expect("failed to run tauri-build");
}
