# Windows desktop implementation
1. Move the web app and content authoring files into web/. Keep the active database and its WAL at the original root var/ path while the web process owns them. Update Pages and entry points.
2. Add a Windows launcher with WebView2, one window per user session, a loopback service on a desktop-only port, and a per-launch API token.
3. Snapshot the old database with SQLite backup into the Windows profile if no desktop database exists. Preserve it on later launches. Flush pending study writes before closing.
4. Package the native launcher, service, dependencies and web assets; verify web builds from the new directory and run native migration, API, and reopen tests. No Git writes.
