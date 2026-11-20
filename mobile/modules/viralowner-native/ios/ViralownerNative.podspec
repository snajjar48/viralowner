Pod::Spec.new do |s|
  s.name           = 'ViralownerNative'
  s.version        = '1.0.0'
  s.summary        = 'viralowner: Photos picking and uploading of original clips, and keeping the login'
  s.description    = 'viralowner: Photos picking and uploading of original clips, and keeping the login'
  s.author         = 'viralowner'
  s.homepage       = 'https://www.viralowner.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true
  s.swift_version  = '5.9'

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Photos', 'PhotosUI', 'WebKit', 'Security', 'AVFoundation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
