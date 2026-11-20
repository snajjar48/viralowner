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

final class Uploader: NSObject, URLSessionTaskDelegate, URLSessionDataDelegate {
  private struct Job {
    let ref: String
    let promise: Promise
    let fileURL: URL
    var lastPercent: Int
  }

  var onProgress: ((String, Int) -> Void)?
  private let queue = DispatchQueue(label: "com.viralowner.app.uploader")
  private var jobs: [Int: Job] = [:]
  private var taskByRef: [String: URLSessionUploadTask] = [:]

  private lazy var session: URLSession = {
    // A background session: the upload keeps going while the app is in the background for a while.
    let config = URLSessionConfiguration.background(withIdentifier: "com.viralowner.app.uploads")
    config.isDiscretionary = false
    config.sessionSendsLaunchEvents = false
    config.allowsCellularAccess = true
    return URLSession(configuration: config, delegate: self, delegateQueue: nil)
  }()

  func start(ref: String, fileURL: URL, url: URL, headers: [String: String], promise: Promise) {
    var request = URLRequest(url: url)
    request.httpMethod = "PUT"
    for (name, value) in headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    let task = session.uploadTask(with: request, fromFile: fileURL)
    queue.sync {
      jobs[task.taskIdentifier] = Job(ref: ref, promise: promise, fileURL: fileURL, lastPercent: -1)
      taskByRef[ref] = task
    }
    task.resume()
  }

  func cancel(ref: String) {
    let task = queue.sync { taskByRef[ref] }
    task?.cancel()
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                  totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
    guard totalBytesExpectedToSend > 0 else { return }
    let percent = min(99, Int(totalBytesSent * 100 / totalBytesExpectedToSend))
    var report: (String, Int)?
    queue.sync {
      if var job = jobs[task.taskIdentifier], job.lastPercent != percent {
        job.lastPercent = percent
        jobs[task.taskIdentifier] = job
        report = (job.ref, percent)
      }
    }
    if let (ref, pct) = report {
      onProgress?(ref, pct)
    }
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    let job: Job? = queue.sync {
      let j = jobs.removeValue(forKey: task.taskIdentifier)
      if let j = j { taskByRef.removeValue(forKey: j.ref) }
      return j
    }
    guard let job = job else { return }
    if let error = error as NSError? {
      if error.domain == NSURLErrorDomain && error.code == NSURLErrorCancelled {
        job.promise.reject("E_CANCELED", "canceled")
      } else {
        job.promise.reject("E_UPLOAD", "the upload didn’t go through. check your connection and try again.")
      }
      return
    }
    let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
    if (200..<300).contains(status) {
      job.promise.resolve(status)
    } else {
      job.promise.reject("E_UPLOAD", "the upload didn’t go through (\(status)).")
    }
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
