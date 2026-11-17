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
  s.source_files   = 'ios/**/*'
end
