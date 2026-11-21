// viralowner's own native code for the iPhone app:
//  - pickVideos: the Photos picker, returning at once with each video's name, size and length (no copying
//    yet, so a big pick doesn't keep people waiting), and
//  - upload: getting one picked video's original bytes from Photos (downloading from iCloud if needed)
//    and uploading them to a signed URL, with progress for both steps.
//  - saveCookies / restoreCookies: a copy of the site's login in the Keychain, so people stay logged in
//    until they sign out (iOS can lose a web view's newest cookies if the app is closed right after).
import AVFoundation
import ExpoModulesCore
import Photos
import PhotosUI
import Security
import UniformTypeIdentifiers
import WebKit

final class PickedClip {
  let ref: String
  let provider: NSItemProvider
  let resource: PHAssetResource?
  var fileURL: URL?
  /// Made smaller already (or tried): a retry uploads the same file.
  var shrinkTried = false
  var shrunk = false

  init(ref: String, provider: NSItemProvider, resource: PHAssetResource?, fileURL: URL?) {
    self.ref = ref
    self.provider = provider
    self.resource = resource
    self.fileURL = fileURL
  }
}

final class PickerDelegate: NSObject, PHPickerViewControllerDelegate {
  private let done: ([PHPickerResult]) -> Void
  private var finished = false

  init(done: @escaping ([PHPickerResult]) -> Void) {
    self.done = done
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    if finished { return }
    finished = true
    done(results)
  }
}

/// Uploads a clip to signed PUT URLs: one URL, or several parts at once (each part its own URL; the
/// site joins them after). A failed part is tried again twice. Progress is for the whole clip.
final class Uploader: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
  private final class Part {
    let index: Int
    let fileURL: URL
    let url: URL
    let headers: [String: String]
    let bytes: Int64
    var sent: Int64 = 0
    var attempts = 0
    var done = false

    init(index: Int, fileURL: URL, url: URL, headers: [String: String], bytes: Int64) {
      self.index = index
      self.fileURL = fileURL
      self.url = url
      self.headers = headers
      self.bytes = bytes
    }
  }

  private final class Group {
    let ref: String
    let promise: Promise
    let parts: [Part]
    /// Part files made for this upload (deleted after); not the clip's own file.
    let temporary: [URL]
    var lastPercent = -1
    var finished = false

    init(ref: String, promise: Promise, parts: [Part], temporary: [URL]) {
      self.ref = ref
      self.promise = promise
      self.parts = parts
      self.temporary = temporary
    }

    var total: Int64 { parts.reduce(0) { $0 + $1.bytes } }
    var sent: Int64 { parts.reduce(0) { $0 + ($1.done ? $1.bytes : $1.sent) } }
  }

  var onProgress: ((String, Int) -> Void)?
  private let queue = DispatchQueue(label: "com.viralowner.app.uploader")
  private var groups: [String: Group] = [:]
  private var tasks: [Int: (Group, Part)] = [:]

  private lazy var session: URLSession = {
    // A background session: the upload keeps going while the app is in the background for a while.
    let config = URLSessionConfiguration.background(withIdentifier: "com.viralowner.app.uploads")
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = false
    config.allowsCellularAccess = true
    config.httpMaximumConnectionsPerHost = 6 // parts of one clip go at once
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  /// The whole file to one URL.
  func start(ref: String, fileURL: URL, url: URL, headers: [String: String], promise: Promise) {
    let size = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value ?? 0
    let part = Part(index: 0, fileURL: fileURL, url: url, headers: headers, bytes: size)
    run(Group(ref: ref, promise: promise, parts: [part], temporary: []))
  }

  /// The file in parts of `partBytes`, part i to urls[i], several at once.
  func startParts(ref: String, fileURL: URL, urls: [URL], partBytes: Int64, promise: Promise) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let (parts, files) = try Uploader.split(fileURL, ref: ref, urls: urls, partBytes: partBytes)
        self.run(Group(ref: ref, promise: promise, parts: parts, temporary: files))
      } catch {
        promise.reject("E_UPLOAD", "we couldn’t get that video ready to upload. try again.")
      }
    }
  }

  /// Background uploads need a file per part.
  private static func split(_ fileURL: URL, ref: String, urls: [URL], partBytes: Int64) throws -> ([Part], [URL]) {
    let size = (try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? NSNumber)?.int64Value ?? 0
    guard size > 0, partBytes > 0 else { throw NSError(domain: "viralowner", code: 1) }
    let count = Int((size + partBytes - 1) / partBytes)
    guard count <= urls.count else { throw NSError(domain: "viralowner", code: 2) }
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("parts-\(ref)", isDirectory: true)
    try? FileManager.default.removeItem(at: dir)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let reader = try FileHandle(forReadingFrom: fileURL)
    defer { try? reader.close() }
    var parts: [Part] = []
    var files: [URL] = []
    for i in 0..<count {
      let data = try autoreleasepool { try reader.read(upToCount: Int(partBytes)) } ?? Data()
      let partURL = dir.appendingPathComponent("\(i)")
      try data.write(to: partURL)
      files.append(partURL)
      parts.append(Part(index: i, fileURL: partURL, url: urls[i], headers: [:], bytes: Int64(data.count)))
    }
    files.append(dir)
    return (parts, files)
  }

  private func run(_ group: Group) {
    queue.sync { groups[group.ref] = group }
    for part in group.parts {
      send(part, of: group)
    }
  }

  private func send(_ part: Part, of group: Group) {
    var request = URLRequest(url: part.url)
    request.httpMethod = "PUT"
    for (name, value) in part.headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    let task = session.uploadTask(with: request, fromFile: part.fileURL)
    queue.sync {
      part.attempts += 1
      part.sent = 0
      tasks[task.taskIdentifier] = (group, part)
    }
    task.resume()
  }

  func cancel(ref: String) {
    let (ids, temporary): ([Int], [URL]) = queue.sync {
      guard let group = groups[ref] else { return ([], []) }
      group.finished = true
      groups.removeValue(forKey: ref)
      return (tasks.filter { $0.value.0 === group }.map { $0.key }, group.temporary)
    }
    for url in temporary {
      try? FileManager.default.removeItem(at: url)
    }
    if ids.isEmpty { return }
    session.getAllTasks { all in
      for task in all where ids.contains(task.taskIdentifier) {
        task.cancel()
      }
    }
  }

  private func finish(_ group: Group, error: (String, String)?) {
    let first: Bool = queue.sync {
      if group.finished { return false }
      group.finished = true
      groups.removeValue(forKey: group.ref)
      return true
    }
    if !first { return }
    for url in group.temporary {
      try? FileManager.default.removeItem(at: url)
    }
    if let failure = error {
      group.promise.reject(failure.0, failure.1)
    } else {
      group.promise.resolve(group.parts.count)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    var report: (String, Int)?
    queue.sync {
      guard let entry = tasks[task.taskIdentifier], !entry.0.finished else { return }
      let (group, part) = entry
      part.sent = totalBytesSent
      let total = group.total
      guard total > 0 else { return }
      let percent = min(99, Int(group.sent * 100 / total))
      if percent != group.lastPercent {
        group.lastPercent = percent
        report = (group.ref, percent)
      }
    }
    if let (ref, pct) = report {
      onProgress?(ref, pct)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let entry = queue.sync(execute: { tasks.removeValue(forKey: task.taskIdentifier) }) else { return }
    let (group, part) = entry
    if group.finished { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    if let error = error as NSError?, error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
      finish(group, error: ("E_CANCELED", "canceled"))
      return
    }
    if error == nil && (200..<300).contains(status) {
      let allDone: Bool = queue.sync {
        part.done = true
        return group.parts.allSatisfy { $0.done }
      }
      if allDone { finish(group, error: nil) }
      return
    }
    // This part didn't go through: try it again (twice), else the upload failed.
    let again = queue.sync { part.attempts < 3 }
    if again {
      DispatchQueue.global().asyncAfter(deadline: .now() + Double(part.attempts)) {
        if !group.finished { self.send(part, of: group) }
      }
    } else if error != nil {
      finish(group, error: ("E_UPLOAD", "the upload didn’t go through. check your connection and try again."))
    } else {
      finish(group, error: ("E_UPLOAD", "the upload didn’t go through (\(status))."))
    }
  }
}

/// Makes a big vertical clip smaller before it uploads: 4K down to 1440p (the finished videos are
/// 1080p, so nothing is lost), same frame rate (slow motion needs every frame), HDR kept. Returns
/// nil to upload the original (not big, sideways, or the copy didn't work or wasn't much smaller).
enum Shrinker {
  static let target: CGFloat = 1440

  static func shrink(_ src: URL, ref: String, progress: @escaping (Int) -> Void) async -> URL? {
    let asset = AVURLAsset(url: src)
    guard let found = try? await asset.loadTracks(withMediaType: .video), let track = found.first,
          let props = try? await track.load(.naturalSize, .preferredTransform, .minFrameDuration, .formatDescriptions)
    else { return nil }
    let (natural, transform, minFrame, formats) = props
    let oriented = natural.applying(transform)
    let w = abs(oriented.width)
    let h = abs(oriented.height)
    let short = min(w, h)
    // Only tall (vertical) clips bigger than 1440p: sideways ones get cropped to vertical later and
    // need all their pixels.
    guard h > w, short > target + 60 else { return nil }
    let scale = target / short
    let size = CGSize(width: (w * scale / 2).rounded() * 2, height: (h * scale / 2).rounded() * 2)

    let composition = AVMutableVideoComposition(asset: asset) { request in
      let image = request.sourceImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
      request.finish(with: image, context: nil)
    }
    composition.renderSize = size
    if minFrame.isValid && minFrame.seconds > 0 {
      composition.frameDuration = minFrame
    }
    // HDR stays HDR (the editor makes it look right for every phone).
    if let format = formats.first,
       let transfer = CMFormatDescriptionGetExtension(format, extensionKey: kCMFormatDescriptionExtension_TransferFunction) as? String {
      if transfer == (kCMFormatDescriptionTransferFunction_ITU_R_2100_HLG as String) {
        composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_2020
        composition.colorTransferFunction = AVVideoTransferFunction_ITU_R_2100_HLG
        composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_2020
      } else if transfer == (kCMFormatDescriptionTransferFunction_SMPTE_ST_2084_PQ as String) {
        composition.colorPrimaries = AVVideoColorPrimaries_ITU_R_2020
        composition.colorTransferFunction = AVVideoTransferFunction_SMPTE_ST_2084_PQ
        composition.colorYCbCrMatrix = AVVideoYCbCrMatrix_ITU_R_2020
      }
    }

    guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPresetHEVCHighestQuality) else { return nil }
    let dest = FileManager.default.temporaryDirectory.appendingPathComponent("clips/\(ref)-small.mov")
    try? FileManager.default.removeItem(at: dest)
    export.outputURL = dest
    export.outputFileType = .mov
    export.videoComposition = composition
    export.shouldOptimizeForNetworkUse = false

    let timer = DispatchSource.makeTimerSource(queue: .global())
    timer.schedule(deadline: .now() + 0.3, repeating: 0.3)
    var last = -1
    timer.setEventHandler {
      let p = min(99, Int(export.progress * 100))
      if p != last {
        last = p
        progress(p)
      }
    }
    timer.resume()
    await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
      export.exportAsynchronously { done.resume() }
    }
    timer.cancel()

    let before = (try? FileManager.default.attributesOfItem(atPath: src.path)[.size] as? NSNumber)?.int64Value ?? 0
    let after = (try? FileManager.default.attributesOfItem(atPath: dest.path)[.size] as? NSNumber)?.int64Value ?? 0
    guard export.status == .completed, after > 0, before > 0, Double(after) < Double(before) * 0.8 else {
      try? FileManager.default.removeItem(at: dest)
      return nil
    }
    return dest
  }
}

public class ViralownerNativeModule: Module {
  private let queue = DispatchQueue(label: "com.viralowner.app.clips")
  private var clips: [String: PickedClip] = [:]
  private var pickerDelegate: PickerDelegate?
  private lazy var uploader: Uploader = {
    let u = Uploader()
    u.onProgress = { [weak self] ref, percent in
      self?.sendEvent("onProgress", ["ref": ref, "phase": "uploading", "percent": percent])
    }
    return u
  }()

  public func definition() -> ModuleDefinition {
    Name("ViralownerNative")

    Events("onProgress")

    AsyncFunction("pickVideos") { (limit: Int, promise: Promise) in
      // Access to the library lets us read the picked videos straight from Photos (no copy first).
      PHPhotoLibrary.requestAuthorization(for: .readWrite) { _ in
        DispatchQueue.main.async {
          self.presentPicker(limit: limit, promise: promise)
        }
      }
    }

    AsyncFunction("upload") { (ref: String, url: String, headers: [String: String], promise: Promise) in
      guard let target = URL(string: url) else {
        promise.reject("E_URL", "bad upload address")
        return
      }
      guard let clip = self.queue.sync(execute: { self.clips[ref] }) else {
        promise.reject("E_GONE", "the clip isn’t on this phone any more. pick it again.")
        return
      }
      self.prepare(clip) { result in
        switch result {
        case .failure(let message):
          promise.reject("E_PREPARE", message)
        case .success(let fileURL):
          self.uploader.start(ref: ref, fileURL: fileURL, url: target, headers: headers, promise: promise)
        }
      }
    }

    // Gets a picked video ready to upload: from Photos (downloading from iCloud if needed), then, when
    // asked and it's a big vertical clip, made smaller. Says the file's final size and type, which the
    // upload URLs are made for.
    AsyncFunction("prepare") { (ref: String, shrink: Bool, promise: Promise) in
      guard let clip = self.queue.sync(execute: { self.clips[ref] }) else {
        promise.reject("E_GONE", "the clip isn’t on this phone any more. pick it again.")
        return
      }
      self.prepare(clip) { result in
        switch result {
        case .failure(let message):
          promise.reject("E_PREPARE", message)
        case .success(let fileURL):
          Task {
            var url = fileURL
            var shrunk = false
            if shrink && !clip.shrinkTried {
              clip.shrinkTried = true
              self.sendEvent("onProgress", ["ref": ref, "phase": "shrinking", "percent": 0])
              if let small = await Shrinker.shrink(fileURL, ref: ref, progress: { percent in
                self.sendEvent("onProgress", ["ref": ref, "phase": "shrinking", "percent": percent])
              }) {
                try? FileManager.default.removeItem(at: fileURL) // (our own copy from Photos)
                clip.fileURL = small
                url = small
                shrunk = true
              }
            } else if clip.shrunk {
              shrunk = true
            }
            clip.shrunk = shrunk
            let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
            let ext = url.pathExtension.lowercased()
            promise.resolve([
              "size": size,
              "type": (ext == "mp4" || ext == "m4v") ? "video/mp4" : "video/quicktime",
              "shrunk": shrunk,
            ])
          }
        }
      }
    }

    // Uploads a prepared clip in parts, several at once (part i to urls[i]).
    AsyncFunction("uploadParts") { (ref: String, urls: [String], partBytes: Double, promise: Promise) in
      let targets = urls.compactMap { URL(string: $0) }
      guard targets.count == urls.count, !targets.isEmpty, partBytes > 0 else {
        promise.reject("E_URL", "bad upload address")
        return
      }
      guard let clip = self.queue.sync(execute: { self.clips[ref] }) else {
        promise.reject("E_GONE", "the clip isn’t on this phone any more. pick it again.")
        return
      }
      self.prepare(clip) { result in
        switch result {
        case .failure(let message):
          promise.reject("E_PREPARE", message)
        case .success(let fileURL):
          self.uploader.startParts(ref: ref, fileURL: fileURL, urls: targets, partBytes: Int64(partBytes), promise: promise)
        }
      }
    }

    Function("cancel") { (ref: String) in
      self.uploader.cancel(ref: ref)
    }

    Function("release") { (ref: String) in
      self.uploader.cancel(ref: ref)
      let clip = self.queue.sync { self.clips.removeValue(forKey: ref) }
      if let url = clip?.fileURL {
        try? FileManager.default.removeItem(at: url)
      }
    }

    AsyncFunction("saveCookies") { (domain: String, promise: Promise) in
      DispatchQueue.main.async {
        WKWebsiteDataStore.default().httpCookieStore.getAllCookies { cookies in
          let mine = cookies.filter { $0.domain == domain || $0.domain.hasSuffix("." + domain) }
          let saved = CookieKeychain.save(mine)
          promise.resolve(saved)
        }
      }
    }

    AsyncFunction("restoreCookies") { (promise: Promise) in
      let saved = CookieKeychain.load()
      if saved.isEmpty {
        promise.resolve(0)
        return
      }
      DispatchQueue.main.async {
        let store = WKWebsiteDataStore.default().httpCookieStore
        store.getAllCookies { existing in
          // Only what's missing: never replaces a newer cookie the web view already has.
          let have = Set(existing.map { "\($0.name)|\($0.domain)|\($0.path)" })
          let now = Date()
          let missing = saved.filter {
            !have.contains("\($0.name)|\($0.domain)|\($0.path)") && ($0.expiresDate == nil || $0.expiresDate! > now)
          }
          if missing.isEmpty {
            promise.resolve(0)
            return
          }
          let group = DispatchGroup()
          for cookie in missing {
            group.enter()
            store.setCookie(cookie) { group.leave() }
          }
          group.notify(queue: .main) { promise.resolve(missing.count) }
        }
      }
    }
  }

  // MARK: - Picking

  private func presentPicker(limit: Int, promise: Promise) {
    var config = PHPickerConfiguration(photoLibrary: .shared())
    config.filter = .videos
    config.selectionLimit = max(1, min(40, limit))
    // The file as filmed: no conversion to a "compatible" copy.
    config.preferredAssetRepresentationMode = .current
    config.selection = .ordered

    let picker = PHPickerViewController(configuration: config)
    let delegate = PickerDelegate { [weak self] results in
      guard let self = self else { return }
      self.pickerDelegate = nil
      DispatchQueue.global(qos: .userInitiated).async {
        promise.resolve(self.describe(results))
      }
    }
    pickerDelegate = delegate
    picker.delegate = delegate

    guard let presenter = appContext?.utilities?.currentViewController() else {
      pickerDelegate = nil
      promise.reject("E_NO_SCREEN", "couldn’t open your photos")
      return
    }
    presenter.present(picker, animated: true)
  }

  /// Name, size, type and length of each picked video, straight from Photos. Only when the library
  /// can't be read (no access) is the video copied here first, the slower way.
  private func describe(_ results: [PHPickerResult]) -> [[String: Any]] {
    var out: [[String: Any]] = []
    for (index, result) in results.enumerated() {
      let ref = UUID().uuidString
      var name = result.itemProvider.suggestedName ?? "clip-\(index + 1)"
      var size: Int64 = 0
      var duration: Double? = nil
      var resource: PHAssetResource? = nil
      var fileURL: URL? = nil

      if let id = result.assetIdentifier,
         let asset = PHAsset.fetchAssets(withLocalIdentifiers: [id], options: nil).firstObject {
        duration = asset.duration
        let resources = PHAssetResource.assetResources(for: asset)
        // The edited version if they edited it in Photos, else the original.
        if let r = resources.first(where: { $0.type == .fullSizeVideo }) ?? resources.first(where: { $0.type == .video }) {
          resource = r
          name = r.originalFilename
          size = (r.value(forKey: "fileSize") as? NSNumber)?.int64Value ?? 0
        }
      }

      if resource == nil || size <= 0 {
        // No library access (or no size): copy the file now.
        resource = nil
        if let copied = copyFromProvider(result.itemProvider, ref: ref) {
          fileURL = copied
          size = ((try? FileManager.default.attributesOfItem(atPath: copied.path)[.size]) as? NSNumber)?.int64Value ?? 0
          if duration == nil {
            duration = CMTimeGetSeconds(AVURLAsset(url: copied).duration)
          }
          if (name as NSString).pathExtension.isEmpty {
            name += "." + copied.pathExtension
          }
        } else {
          continue
        }
      }

      if (name as NSString).pathExtension.isEmpty {
        name += ".mov"
      }
      let ext = (name as NSString).pathExtension.lowercased()
      let type = (ext == "mp4" || ext == "m4v") ? "video/mp4" : "video/quicktime"

      queue.sync {
        clips[ref] = PickedClip(ref: ref, provider: result.itemProvider, resource: resource, fileURL: fileURL)
      }
      var item: [String: Any] = ["ref": ref, "name": name, "type": type, "size": size]
      if let d = duration, d.isFinite, d > 0 {
        item["durationS"] = d
      }
      out.append(item)
    }
    return out
  }

  private func tempURL(ref: String, ext: String) -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("clips", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("\(ref).\(ext.isEmpty ? "mov" : ext)")
  }

  private func copyFromProvider(_ provider: NSItemProvider, ref: String) -> URL? {
    let done = DispatchSemaphore(value: 0)
    var out: URL? = nil
    provider.loadFileRepresentation(forTypeIdentifier: UTType.movie.identifier) { url, _ in
      if let url = url {
        let dest = self.tempURL(ref: ref, ext: url.pathExtension)
        try? FileManager.default.removeItem(at: dest)
        if (try? FileManager.default.copyItem(at: url, to: dest)) != nil {
          out = dest
        }
      }
      done.signal()
    }
    done.wait()
    return out
  }

  // MARK: - Getting the bytes ready

  private enum Prepared {
    case success(URL)
    case failure(String)
  }

  private func prepare(_ clip: PickedClip, completion: @escaping (Prepared) -> Void) {
    if let url = clip.fileURL, FileManager.default.fileExists(atPath: url.path) {
      completion(.success(url))
      return
    }
    guard let resource = clip.resource else {
      DispatchQueue.global(qos: .userInitiated).async {
        if let url = self.copyFromProvider(clip.provider, ref: clip.ref) {
          clip.fileURL = url
          completion(.success(url))
        } else {
          completion(.failure("we couldn’t read that video from your photos. try picking it again."))
        }
      }
      return
    }
    let dest = tempURL(ref: clip.ref, ext: (resource.originalFilename as NSString).pathExtension)
    try? FileManager.default.removeItem(at: dest)
    let options = PHAssetResourceRequestOptions()
    options.isNetworkAccessAllowed = true // a video kept in iCloud downloads first
    var last = -1
    let ref = clip.ref
    options.progressHandler = { [weak self] progress in
      let percent = min(99, Int(progress * 100))
      if percent != last {
        last = percent
        self?.sendEvent("onProgress", ["ref": ref, "phase": "preparing", "percent": percent])
      }
    }
    PHAssetResourceManager.default().writeData(for: resource, toFile: dest, options: options) { error in
      if error != nil {
        try? FileManager.default.removeItem(at: dest)
        completion(.failure("we couldn’t get that video from your photos. if it’s in icloud, check you’re online, then try again."))
      } else {
        clip.fileURL = dest
        completion(.success(dest))
      }
    }
  }
}

/// The site's cookies, kept in the Keychain (only on this phone, readable after the first unlock).
enum CookieKeychain {
  private static let service = "com.viralowner.app.cookies"
  private static let account = "web"

  static func save(_ cookies: [HTTPCookie]) -> Int {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
    if cookies.isEmpty { return 0 } // signed out: nothing to keep
    let list: [[String: Any]] = cookies.compactMap { cookie in
      guard let props = cookie.properties else { return nil }
      var plain: [String: Any] = [:]
      for (key, value) in props {
        if value is String || value is Date || value is NSNumber {
          plain[key.rawValue] = value
        } else if let url = value as? URL {
          plain[key.rawValue] = url.absoluteString
        }
      }
      return plain
    }
    guard let data = try? PropertyListSerialization.data(fromPropertyList: list, format: .binary, options: 0) else {
      return 0
    }
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    return SecItemAdd(add as CFDictionary, nil) == errSecSuccess ? cookies.count : 0
  }

  static func load() -> [HTTPCookie] {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data,
          let list = (try? PropertyListSerialization.propertyList(from: data, options: [], format: nil)) as? [[String: Any]]
    else { return [] }
    return list.compactMap { plain in
      var props: [HTTPCookiePropertyKey: Any] = [:]
      for (key, value) in plain {
        props[HTTPCookiePropertyKey(rawValue: key)] = value
      }
      return HTTPCookie(properties: props)
    }
  }
}
