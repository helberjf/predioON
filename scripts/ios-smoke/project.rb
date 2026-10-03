# Generate a standalone, locally signed XCUITest runner in the private CI folder.
require 'pathname'
require 'fileutils'
require 'xcodeproj'

abort 'Disposable macOS CI runner required' unless ENV['GITHUB_ACTIONS'] == 'true' && ENV['RUNNER_OS'] == 'macOS'
temporary = Pathname.new(ENV.fetch('RUNNER_TEMP')).realpath
folder = Pathname.new(ARGV.fetch(0)).realpath
abort 'Project must stay below RUNNER_TEMP' unless folder.to_s.start_with?(temporary.to_s + '/')
path = folder.join('AuthJourney.xcodeproj')
abort 'Runner project already exists' if path.exist?
FileUtils.cp(File.join(__dir__, 'AuthJourney.swift'), folder.join('AuthJourney.swift'))
abort 'Private generated runner configuration missing' unless folder.join('AuthConfiguration.swift').file?
project = Xcodeproj::Project.new(path.to_s)
target = project.new_target(:ui_test_bundle, 'AuthJourney', :ios, '15.1', nil, :swift)
Xcodeproj::Plist.write_to_path({
  'NSAppTransportSecurity' => {
    'NSAllowsLocalNetworking' => true
  }
}, folder.join('RunnerInfo.plist').to_s)
%w[AuthJourney.swift AuthConfiguration.swift].each { |name| target.source_build_phase.add_file_reference(project.main_group.new_file(name)) }
target.build_configurations.each do |config|
  config.build_settings.merge!({
    'PRODUCT_BUNDLE_IDENTIFIER' => 'com.predioon.authjourney',
    'GENERATE_INFOPLIST_FILE' => 'YES', 'INFOPLIST_FILE' => 'RunnerInfo.plist', 'SWIFT_VERSION' => '5.0',
    'ENABLE_TESTING_SEARCH_PATHS' => 'YES', 'USES_XCTRUNNER' => 'YES',
    'CODE_SIGNING_ALLOWED' => 'YES', 'CODE_SIGN_IDENTITY' => '-',
    'TARGETED_DEVICE_FAMILY' => '1', 'SUPPORTED_PLATFORMS' => 'iphonesimulator'
  })
end
project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target, false)
scheme.add_test_target(target)
scheme.test_action.build_configuration = 'Release'
scheme.test_action.xml_element.add_attribute('systemAttachmentLifetime', 'keepNever')
scheme.test_action.xml_element.add_attribute('userAttachmentLifetime', 'keepNever')
scheme.test_action.xml_element.add_attribute('shouldAutocreateTestPlan', 'NO')
scheme.save_as(path.to_s, 'AuthJourney', true)
puts 'Standalone simulator UI-test runner generated; private source not exported'
