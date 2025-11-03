#!/usr/bin/env swift
import Foundation
import Darwin

@discardableResult
func copyFile(_ src: String, _ dst: String, strategy: String = "auto") throws -> String {
    let fm = FileManager.default
    try fm.createDirectory(atPath: (dst as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
    var st = stat()
    guard lstat(src, &st) == 0 else {
        throw NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: nil)
    }
    let sameDevice = ({ () -> Bool in
        var dstParent = stat()
        let parent = (dst as NSString).deletingLastPathComponent
        if lstat(parent, &dstParent) != 0 { return false }
        return st.st_dev == dstParent.st_dev
    })()

    let order: [String]
    switch strategy {
    case "clone": order = ["clone", "copy"]
    case "hardlink": order = ["hardlink", "copy"]
    case "copy": order = ["copy"]
    case "move": order = ["move", "clone", "hardlink", "copy"]
    default:
        order = sameDevice ? ["clone", "hardlink", "copy"] : ["clone", "copy"]
    }

    let tmp = dst + ".tmp-" + UUID().uuidString
    var lastErr: NSError?
    for step in order {
        switch step {
        case "clone":
            if clonefile(src, tmp, 0) == 0 { try fm.replaceItemAt(URL(fileURLWithPath: dst), withItemAt: URL(fileURLWithPath: tmp)); return "clone" }
            if errno == EXDEV || errno == ENOTSUP { break }
        case "hardlink":
            if link(src, tmp) == 0 { try fm.replaceItemAt(URL(fileURLWithPath: dst), withItemAt: URL(fileURLWithPath: tmp)); return "hardlink" }
            if errno == EXDEV { break }
        case "move":
            if rename(src, tmp) == 0 { try fm.replaceItemAt(URL(fileURLWithPath: dst), withItemAt: URL(fileURLWithPath: tmp)); return "move" }
        default:
            let flags = UInt32(COPYFILE_ALL)
            if copyfile(src, tmp, nil, flags) == 0 { try fm.replaceItemAt(URL(fileURLWithPath: dst), withItemAt: URL(fileURLWithPath: tmp)); return "copy" }
        }
        lastErr = NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: nil)
        unlink(tmp)
    }
    throw lastErr ?? NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: nil)
}

func copyTree(_ src: String, _ dst: String, strategy: String = "auto") throws {
    let fm = FileManager.default
    try fm.createDirectory(atPath: dst, withIntermediateDirectories: true)
    let enumerator = fm.enumerator(atPath: src)
    while let rel = enumerator?.nextObject() as? String {
        let from = (src as NSString).appendingPathComponent(rel)
        let to = (dst as NSString).appendingPathComponent(rel)
        var st = stat()
        if lstat(from, &st) != 0 { continue }
        if (st.st_mode & S_IFMT) == S_IFDIR { try fm.createDirectory(atPath: to, withIntermediateDirectories: true); continue }
        if (st.st_mode & S_IFMT) != S_IFREG { continue }
        let mode = try copyFile(from, to, strategy: strategy)
        print("{\"op\":\"copy\",\"from\":\"\(from)\",\"to\":\"\(to)\",\"mode\":\"\(mode)\"}")
    }
}

if CommandLine.argc >= 3 {
    let src = CommandLine.arguments[CommandLine.argc - 2]
    let dst = CommandLine.arguments.last!
    let recursive = CommandLine.arguments.contains("-r") || CommandLine.arguments.contains("--recursive")
    let strategy = (CommandLine.arguments.firstIndex(of: "--strategy").flatMap { idx -> String? in
        let next = idx + 1
        return next < CommandLine.arguments.count ? CommandLine.arguments[next] : nil
    }) ?? "auto"
    if recursive {
        try copyTree(src, dst, strategy: strategy)
    } else {
        let mode = try copyFile(src, dst, strategy: strategy)
        print("{\"op\":\"copy\",\"from\":\"\(src)\",\"to\":\"\(dst)\",\"mode\":\"\(mode)\"}")
    }
} else {
    fputs("usage: copyOps [-r] [--strategy clone|copy|hardlink|move] SRC DST\n", stderr)
    exit(2)
}
