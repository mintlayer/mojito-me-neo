require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'mojito-core'
  s.version        = package['version']
  s.summary        = 'Mojito wallet core: secure random, AES-GCM sealed storage, bindings facade'
  s.description    = 'Local Expo module backing the Mojito wallet: Keystore/Keychain resident AES-256-GCM keys and the Mintlayer bindings facade.'
  s.author         = { 'Mojito' => 'dev@mojito.me' }
  s.license        = { :type => 'MIT' }
  s.homepage       = 'https://mojito.me'
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.6'
  s.source         = { :path => __dir__ }
  s.dependency 'ExpoModulesCore'
  s.source_files   = 'ios/**/*', '../../../vendor/mintlayer/MintlayerWalletBindings.swift'
  # Vendored Mintlayer wallet bindings (UniFFI static library), release
  # wallet-bindings-v0.1.0; checksums in vendor/mintlayer/CHECKSUMS.txt.
  # The generated Swift API source ships beside the binary and is compiled
  # into this pod so Swift can drive the FFI.
  s.vendored_frameworks = '../../../vendor/mintlayer/MintlayerWalletBindings.xcframework'
end
