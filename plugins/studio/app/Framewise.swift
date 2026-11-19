// Framewise.app: the editor as a Mac app. One window, no Terminal.
//
// On launch it checks what the editor needs (runtime.sh), shows a setup screen for anything missing, starts the
// editor's own server (home.py, bundled in Resources/plugins) and shows its page in this window. Claude Code still
// does the editing behind it, signed in with the user's own Claude account.
import Cocoa
import WebKit

let PORT = 47821

func resource(_ rel: String) -> String { Bundle.main.resourcePath! + "/" + rel }

func aiHome() -> String {
    if let h = ProcessInfo.processInfo.environment["AI_EDITOR_HOME"], !h.isEmpty { return h }
    return NSHomeDirectory() + "/.ai-video-editor"
}

@discardableResult
func sh(_ args: [String], env: [String: String]? = nil, cwd: String? = nil, onLine: ((String) -> Void)? = nil) -> (Int32, String) {
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/bin/bash")
    p.arguments = args
    if let env = env { p.environment = env }
    if let cwd = cwd { p.currentDirectoryURL = URL(fileURLWithPath: cwd) }
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = pipe
    var out = ""
    do { try p.run() } catch { return (127, "\(error)") }
    let h = pipe.fileHandleForReading
    var rest = ""
    while true {
        let d = h.availableData
        if d.isEmpty { break }
        let s = String(decoding: d, as: UTF8.self)
        out += s
        rest += s
        while let r = rest.range(of: "\n") {
            let line = String(rest[..<r.lowerBound])
            rest = String(rest[r.upperBound...])
            if let f = onLine { DispatchQueue.main.async { f(line) } }
        }
    }
    p.waitUntilExit()
    return (p.terminationStatus, out)
}

let SETUP_HTML = """
<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:dark}body{margin:0;color:#F2F4F8;font:14.5px/1.5 -apple-system,BlinkMacSystemFont,"SF Pro Text",sans-serif;
background:radial-gradient(900px 480px at 50% -160px,rgba(61,123,255,.18),transparent 70%),#0A0B0E;
display:flex;align-items:center;justify-content:center;height:100vh}
main{width:520px}.logo{width:60px;height:60px;margin-bottom:18px;filter:drop-shadow(0 10px 26px rgba(61,123,255,.45))}.logo svg{width:100%;height:100%;display:block}h1{font-size:38px;font-weight:650;letter-spacing:-.03em;margin:0 0 6px}p{color:rgba(232,236,245,.6);margin:0 0 24px}
.r{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:13px 16px;background:#13151A;border:1px solid rgba(255,255,255,.075);border-radius:14px;margin-bottom:8px}
.r b{font-weight:620}.r span{color:rgba(232,236,245,.56);text-align:right}.ok span{color:#34D399}.bad span{color:#FF8A7A}
button{font:inherit;font-weight:620;color:#fff;border:0;border-radius:10px;padding:11px 20px;margin-top:16px;cursor:pointer;
background:linear-gradient(180deg,#5C92FF,#2A62E8);box-shadow:0 1px 0 rgba(255,255,255,.22) inset,0 6px 22px rgba(61,123,255,.32)}
button:hover{filter:brightness(1.08)}button[disabled]{opacity:.5;cursor:default;box-shadow:none}
button.b2{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);box-shadow:none;margin-left:8px}
#note{margin-top:16px;color:rgba(232,236,245,.56);font-size:13.5px;min-height:20px}
</style></head><body><main>
<div class="logo"><svg viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5C92FF"/><stop offset="1" stop-color="#2A62E8"/></linearGradient></defs><rect width="64" height="64" rx="15" fill="url(#g)"/><path d="M19 22a5 5 0 0 1 5-5h9M45 42a5 5 0 0 1-5 5h-9M19 31v11a5 5 0 0 0 5 5M45 33V22a5 5 0 0 0-5-5" fill="none" stroke="#fff" stroke-width="4.2" stroke-linecap="round"/><path d="M27.5 24.5 40 32l-12.5 7.5z" fill="#fff"/></svg></div>
<h1>Framewise</h1><p id="sub">Starting…</p><div id="rows"></div>
<div id="btns"></div><div id="note"></div>
<script>
const NAMES={python:['Python','runs the editor'],node:['Node','renders the video'],ffmpeg:['ffmpeg','cuts and joins video'],
  ffprobe:['ffprobe','reads video files'],claude:['Claude','does the editing, with your own Claude account']};
let st={};
function send(m){window.webkit.messageHandlers.app.postMessage(m)}
function draw(){
  document.getElementById('rows').innerHTML=Object.keys(NAMES).filter(k=>k in st).map(k=>{
    const s=st[k],c=s==='ok'?'ok':(s==='missing'||s.startsWith('failed'))?'bad':'';
    return `<div class="r ${c}"><div><b>${NAMES[k][0]}</b><div style="color:rgba(232,236,245,.42);font-size:13px">${NAMES[k][1]}</div></div><span>${s==='ok'?'Ready':s==='missing'?'Not installed':s}</span></div>`}).join('')}
function setState(o){st=o;draw()}
function setRow(k,v){st[k]=v;draw()}
function sub(t){document.getElementById('sub').textContent=t}
function note(t){document.getElementById('note').textContent=t}
function buttons(h){document.getElementById('btns').innerHTML=h}
</script></main></body></html>
"""

final class DragStrip: NSView {
    override func mouseDown(with e: NSEvent) { if e.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: e) } }
}

// The page is part of the app: no browser menu on right-click (text fields keep cut, copy and paste).
final class AppWebView: WKWebView {
    override func willOpenMenu(_ menu: NSMenu, with event: NSEvent) {
        let keep: Set<String> = ["WKMenuItemIdentifierCopy", "WKMenuItemIdentifierCut", "WKMenuItemIdentifierPaste", "WKMenuItemIdentifierSelectAll"]
        menu.items.filter { !keep.contains($0.identifier?.rawValue ?? "") }.forEach { menu.removeItem($0) }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var env: [String: String] = [:]
    var python = ""
    var extra: [NSWindow] = []
    let runtime = resource("runtime.sh")

    func applicationDidFinishLaunching(_ n: Notification) {
        let cfg = WKWebViewConfiguration()
        cfg.userContentController.add(self, name: "app")
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = true
        // tells the page it is inside the app: it leaves room for the window buttons and stops behaving like a web page
        cfg.userContentController.addUserScript(WKUserScript(source: "window.FW_APP=true;document.addEventListener('DOMContentLoaded',function(){document.body.classList.add('fw-app')});",
                                                             injectionTime: .atDocumentStart, forMainFrameOnly: true))
        web = AppWebView(frame: .zero, configuration: cfg)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = false
        web.allowsMagnification = false
        web.setValue(false, forKey: "drawsBackground")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1360, height: 860),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView], backing: .buffered, defer: false)
        window.title = "Framewise"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.backgroundColor = NSColor(calibratedRed: 0.039, green: 0.043, blue: 0.055, alpha: 1)
        window.appearance = NSAppearance(named: .darkAqua)
        window.minSize = NSSize(width: 1040, height: 680)
        window.center()
        window.setFrameAutosaveName("framewise-main")
        let host = NSView(frame: NSRect(x: 0, y: 0, width: 1360, height: 860))
        web.frame = host.bounds
        web.autoresizingMask = [.width, .height]
        host.addSubview(web)
        let strip = DragStrip(frame: NSRect(x: 76, y: host.bounds.height - 28, width: host.bounds.width - 76, height: 28))   // right of the window buttons
        strip.autoresizingMask = [.width, .minYMargin]
        host.addSubview(strip)
        window.contentView = host
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        buildMenu()
        web.loadHTMLString(SETUP_HTML, baseURL: nil)
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        app.addItem(withTitle: "About Framewise", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Settings…", action: #selector(goSettings), keyEquivalent: ",")
        app.addItem(withTitle: "Check Setup…", action: #selector(recheck), keyEquivalent: "")
        app.addItem(.separator())
        app.addItem(withTitle: "Hide Framewise", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        app.addItem(withTitle: "Quit Framewise", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.addItem(withTitle: "Quit and Stop the Editor", action: #selector(quitAll), keyEquivalent: "")
        appItem.submenu = app
        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
        edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
        edit.addItem(.separator())
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        let fileItem = NSMenuItem(); main.insertItem(fileItem, at: 1)
        let file = NSMenu(title: "File")
        file.addItem(withTitle: "New Video", action: #selector(goNew), keyEquivalent: "n")
        fileItem.submenu = file
        let goItem = NSMenuItem(); main.addItem(goItem)
        let go = NSMenu(title: "Go")
        for (i, t) in [("Home", "home"), ("Videos", "videos"), ("Styles", "mystyle"), ("Library", "library"), ("Activity", "claude")].enumerated() {
            let it = NSMenuItem(title: t.0, action: #selector(goPage(_:)), keyEquivalent: String(i + 1))
            it.representedObject = t.1
            go.addItem(it)
        }
        go.addItem(.separator())
        go.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        goItem.submenu = go
        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        win.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        win.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        winItem.submenu = win
        NSApp.mainMenu = main
        NSApp.windowsMenu = win
    }

    func js(_ s: String) { web.evaluateJavaScript(s, completionHandler: nil) }
    func q(_ s: String) -> String {   // a Swift string as a JavaScript string
        let d = try! JSONSerialization.data(withJSONObject: [s])
        let t = String(decoding: d, as: UTF8.self)
        return String(t.dropFirst().dropLast())
    }

    // ---- setup
    func webView(_ w: WKWebView, didFinish nav: WKNavigation!) {
        if w === web && (w.url == nil || w.url?.absoluteString == "about:blank") { check() }
        if w === web {   // what the window shows, for support: no token in it
            let shown = (w.url?.absoluteString ?? "setup").components(separatedBy: "?").first ?? ""
            w.evaluateJavaScript("document.title + ' | ' + document.body.innerText.slice(0, 160).replace(/\\s+/g, ' ')") { v, _ in
                try? "\(shown)\n\(v as? String ?? "")\n".write(toFile: aiHome() + "/app-window.txt", atomically: true, encoding: .utf8)
            }
        }
    }

    func baseEnv() -> [String: String] {
        var e = ProcessInfo.processInfo.environment
        let (_, path) = sh([runtime, "path"])
        e["PATH"] = path.trimmingCharacters(in: .whitespacesAndNewlines)
        e["LANG"] = e["LANG"] ?? "en_US.UTF-8"
        e["TERM"] = "xterm-256color"
        e["COOKED_APP"] = "1"
        return e
    }

    func check() {
        js("sub('Checking this Mac…');buttons('');note('')")
        DispatchQueue.global().async {
            self.env = self.baseEnv()
            let (_, out) = sh([self.runtime, "check"], env: self.env)
            var st: [String: String] = [:]
            for line in out.split(separator: "\n") {
                let p = line.split(separator: " ", maxSplits: 2).map(String.init)
                if p.count >= 2 { st[p[1]] = p[0] == "ok" ? "ok" : "missing"; if p[1] == "python" && p.count == 3 { self.python = p[2] } }
            }
            DispatchQueue.main.async { self.show(st) }
        }
    }

    func show(_ st: [String: String]) {
        let json = String(decoding: try! JSONSerialization.data(withJSONObject: st), as: UTF8.self)
        js("setState(\(json))")
        let tools = ["python", "node", "ffmpeg", "ffprobe"].filter { st[$0] != "ok" }
        if !tools.isEmpty {
            js("sub('A few free tools are needed first. They go in a folder of their own; nothing asks for a password.');" +
               "buttons('<button onclick=\"send(\\'install\\')\">Install them</button>')")
        } else if st["claude"] != "ok" {
            js("sub('One thing left: Claude Code, which does the editing with your own Claude account.');" +
               "buttons('<button onclick=\"send(\\'claude\\')\">Install Claude Code</button>')")
        } else {
            start()
        }
    }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        guard let what = m.body as? String else { return }
        if what.hasPrefix("badge:") {   // what needs the user, on the Dock icon
            let n = Int(what.dropFirst(6)) ?? 0
            if n > (Int(NSApp.dockTile.badgeLabel ?? "") ?? 0) && !NSApp.isActive { NSApp.requestUserAttention(.informationalRequest) }
            NSApp.dockTile.badgeLabel = n > 0 ? String(n) : nil
            return
        }
        if what == "install" || what == "claude" {
            js("buttons('<button disabled>Installing…</button>');note('This can take a few minutes on a slow connection.')")
            DispatchQueue.global().async {
                sh([self.runtime, what], env: self.env) { line in
                    let p = line.split(separator: " ", maxSplits: 2).map(String.init)
                    guard p.count >= 2 else { return }
                    if p[0] == "step" { self.js("setRow(\(self.q(p[1])),\(self.q(p.count > 2 ? p[2] : "working")))") }
                    if p[0] == "done" { self.js("setRow(\(self.q(p[1])),'ok')") }
                    if p[0] == "fail" { self.js("setRow(\(self.q(p[1])),\(self.q("failed: " + (p.count > 2 ? p[2] : ""))))") }
                }
                DispatchQueue.main.async { self.check() }
            }
        } else if what == "signin" {
            signIn()
        } else if what == "recheck" {
            check()
        }
    }

    // Claude signs in on Claude's own page in the browser; the app starts that and waits. No Terminal.
    var login: Process?
    func signIn() {
        login?.terminate()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = ["-c", "claude auth login"]
        p.environment = env
        p.standardInput = FileHandle.nullDevice
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
        login = p
        js("sub('Finish signing in on the page that opened in your browser. This window carries on by itself.');" +
           "buttons('<button class=\"b2\" style=\"margin-left:0\" onclick=\"send(\\'signin\\')\">Open the sign-in page again</button>');note('Waiting for Claude…')")
        DispatchQueue.global().async {
            for _ in 0..<150 {
                Thread.sleep(forTimeInterval: 2)
                if self.claudeSignedIn() { DispatchQueue.main.async { self.js("note('Signed in.')"); self.start() }; return }
            }
            DispatchQueue.main.async { self.js("note('Still not signed in. Press the button to try again.')") }
        }
    }

    func claudeSignedIn() -> Bool {
        let (_, out) = sh(["-c", "claude auth status --json 2>/dev/null"], env: env)
        if let d = out.data(using: .utf8), let o = try? JSONSerialization.jsonObject(with: d) as? [String: Any] { return o["loggedIn"] as? Bool ?? false }
        return false
    }

    // ---- the editor's own server and page
    func runningURL() -> String? {
        guard let s = try? String(contentsOfFile: aiHome() + "/home/.server", encoding: .utf8) else { return nil }
        let url = s.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let probe = URL(string: url.replacingOccurrences(of: "/?t=", with: "/state?t=")) else { return nil }
        var req = URLRequest(url: probe); req.timeoutInterval = 2
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: req) { _, r, _ in ok = (r as? HTTPURLResponse)?.statusCode == 200; sem.signal() }.resume()
        _ = sem.wait(timeout: .now() + 3)
        return ok ? url : nil
    }

    func start() {
        js("sub('Opening your editor…');buttons('');note('')")
        DispatchQueue.global().async {
            if !self.claudeSignedIn() {
                DispatchQueue.main.async {
                    self.js("sub('Connect your Claude account. Your browser opens on the Claude sign-in page; nothing is typed here.');" +
                            "buttons('<button onclick=\"send(\\'signin\\')\">Connect Claude</button>')")
                }
                return
            }
            var url = self.runningURL()
            if url == nil {
                let home = resource("plugins/ai-editor/lib/ai_editor/home.py")
                let (_, lib) = sh(["-c", "\"$0\" -c 'import sys; sys.path.insert(0, sys.argv[1]); import library; print(library.path())' \"$1\"",
                                    self.python, resource("plugins/ai-editor/lib/ai_editor")], env: self.env)
                var folder = lib.trimmingCharacters(in: .whitespacesAndNewlines).components(separatedBy: "\n").last ?? ""
                if folder.isEmpty || !FileManager.default.fileExists(atPath: folder) {
                    folder = NSHomeDirectory() + "/Movies/cooked"
                    try? FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
                }
                let p = Process()
                p.executableURL = URL(fileURLWithPath: self.python)
                p.arguments = [home, "serve", "--no-open", "--port", String(PORT)]
                p.environment = self.env
                p.currentDirectoryURL = URL(fileURLWithPath: folder)
                let log = aiHome() + "/app-server.log"
                FileManager.default.createFile(atPath: log, contents: nil)
                if let fh = FileHandle(forWritingAtPath: log) { p.standardOutput = fh; p.standardError = fh }
                do { try p.run(); self.server = p } catch {
                    DispatchQueue.main.async { self.js("sub('The editor could not start.');note(\(self.q("\(error)")))") }
                    return
                }
                for _ in 0..<60 {
                    Thread.sleep(forTimeInterval: 0.5)
                    url = self.runningURL()
                    if url != nil || !p.isRunning { break }
                }
            }
            DispatchQueue.main.async {
                if let u = url, let U = URL(string: u) { self.web.load(URLRequest(url: U)) }
                else { self.js("sub('The editor did not start.');note('Details are in ~/.ai-video-editor/app-server.log');buttons('<button onclick=\"send(\\'recheck\\')\">Try again</button>')") }
            }
        }
    }

    // menu items drive the page: on the app's own page they switch section, from the editor they go back to it first
    func page(_ v: String) {
        if web.url?.port == PORT { js("try{rgo('\(v)')}catch(e){}") } else if let u = runningURL(), let U = URL(string: u + "#" + v) { web.load(URLRequest(url: U)) }
    }
    @objc func goSettings() { page("settings") }
    @objc func goNew() { page("new") }
    @objc func goPage(_ s: NSMenuItem) { page(s.representedObject as? String ?? "home") }
    @objc func goHome() { if let u = runningURL(), let U = URL(string: u) { web.load(URLRequest(url: U)) } else { recheck() } }
    @objc func reload() { web.reload() }
    @objc func recheck() { web.loadHTMLString(SETUP_HTML, baseURL: nil) }
    @objc func quitAll() {
        server?.terminate()
        sh(["-c", "pkill -f 'ai_editor/home.py serve' ; pkill -f 'ai_editor/review.py' ; true"])
        NSApp.terminate(nil)
    }

    // ---- pages: the editor's own pages stay in the app, anything else opens in the browser
    func local(_ u: URL?) -> Bool { guard let h = u?.host else { return u?.scheme == "about" }; return h == "127.0.0.1" || h == "localhost" }

    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if a.shouldPerformDownload { decisionHandler(.download); return }
        if let u = a.request.url, !local(u), a.navigationType == .linkActivated || a.targetFrame == nil {
            NSWorkspace.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func webView(_ w: WKWebView, decidePolicyFor r: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        if let h = r.response as? HTTPURLResponse, let d = h.value(forHTTPHeaderField: "Content-Disposition"), d.lowercased().contains("attachment") {
            decisionHandler(.download); return
        }
        decisionHandler(r.canShowMIMEType ? .allow : .download)
    }

    // window.open and target=_blank: a second window of the app (the Library page, a video's editor)
    func webView(_ w: WKWebView, createWebViewWith cfg: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url, !local(u) { NSWorkspace.shared.open(u); return nil }
        let v = WKWebView(frame: .zero, configuration: cfg)
        v.navigationDelegate = self
        v.uiDelegate = self
        let win = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        win.title = "Framewise"
        win.isReleasedWhenClosed = false
        win.contentView = v
        win.cascadeTopLeft(from: window.frame.origin)
        win.makeKeyAndOrderFront(nil)
        extra.append(win)
        return v
    }
    func webViewDidClose(_ w: WKWebView) { w.window?.close() }

    func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = p.allowsMultipleSelection
        panel.canChooseDirectories = p.allowsDirectories
        panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
    }
    func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = NSAlert(); a.messageText = m; a.runModal(); completionHandler()
    }
    func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        completionHandler(a.runModal() == .alertFirstButtonReturn)
    }
    func webView(_ w: WKWebView, runJavaScriptTextInputPanelWithPrompt m: String, defaultText t: String?, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 320, height: 24)); field.stringValue = t ?? ""
        a.accessoryView = field
        completionHandler(a.runModal() == .alertFirstButtonReturn ? field.stringValue : nil)
    }
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor o: WKSecurityOrigin, initiatedByFrame f: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.prompt)
    }

    // ---- downloads go to the Downloads folder and are shown in Finder
    func webView(_ w: WKWebView, navigationAction a: WKNavigationAction, didBecome d: WKDownload) { d.delegate = self }
    func webView(_ w: WKWebView, navigationResponse r: WKNavigationResponse, didBecome d: WKDownload) { d.delegate = self }
    var saved: [ObjectIdentifier: URL] = [:]
    func download(_ d: WKDownload, decideDestinationUsing r: URLResponse, suggestedFilename name: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        var dest = dir.appendingPathComponent(name)
        var k = 1
        while FileManager.default.fileExists(atPath: dest.path) {
            k += 1
            let ext = (name as NSString).pathExtension, base = (name as NSString).deletingPathExtension
            dest = dir.appendingPathComponent(ext.isEmpty ? "\(base) \(k)" : "\(base) \(k).\(ext)")
        }
        saved[ObjectIdentifier(d)] = dest
        completionHandler(dest)
    }
    func downloadDidFinish(_ d: WKDownload) {
        if let u = saved.removeValue(forKey: ObjectIdentifier(d)) { NSWorkspace.shared.activateFileViewerSelecting([u]) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows v: Bool) -> Bool {
        if !v { window.makeKeyAndOrderFront(nil) }
        return true
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
