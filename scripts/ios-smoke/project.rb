# Generate a standalone, locally signed XCUITest runner in the private CI folder.
require 'pathname'
require 'fileutils'
require 'find'
require 'open3'
require 'xcodeproj'

def simulator_platform
  output = ''.b
  deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 15
  Open3.popen2('/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-platform-path', err: File::NULL, pgroup: true) do |input, stream, child|
    completed = false
    begin
      input.close
      loop do
        remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
        raise 'Discovery deadline' unless remaining.positive? && IO.select([stream], nil, nil, remaining)
        begin
          output << stream.read_nonblock(4097 - output.bytesize)
          raise 'Discovery output limit' if output.bytesize > 4096
        rescue EOFError
          break
        rescue IO::WaitReadable
          next
        end
      end
      remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise 'Discovery failed' unless remaining.positive? && child.join(remaining) && child.value.success?
      completed = true
    ensure
      stream.close unless stream.closed?
      if !completed || child.alive?
        begin
          Process.kill('KILL', -child.pid)
        rescue Errno::ESRCH
          # The owned group may already have terminated, including its leader.
        end
        child.join(2)
      end
    end
  end
  output.force_encoding(Encoding::UTF_8)
  raise 'Invalid discovery output' unless output.valid_encoding?
  path = output.delete_suffix("\n")
  raise 'Invalid discovery path' if path.empty? || path.match?(/[\x00-\x1f\x7f]/)
  platform = Pathname.new(path)
  raise 'Invalid simulator platform' unless platform.absolute? && platform.basename.to_s == 'iPhoneSimulator.platform'
  raise 'Linked simulator platform' unless platform.lstat.directory? && !platform.lstat.symlink?
  platform.realpath
end

def strict_xctrunner(folder)
  raise 'Runner folder must be private' unless folder.stat.uid == Process.uid && (folder.stat.mode & 077).zero?
  platform = simulator_platform
  source = platform
  %w[Developer Library Xcode Agents XCTRunner.app].each do |component|
    source = source.join(component)
    raise 'Invalid runner source directory' unless source.lstat.directory? && !source.lstat.symlink?
    raise 'Escaped runner source' unless source.realpath.to_s.start_with?(platform.to_s + '/')
  end
  source = source.realpath
  # Validate the selected Apple agent before the standard library copies it.
  # No resources may reference files outside this bundle, or require special file IO.
  Find.find(source.to_s) do |entry|
    attributes = File.lstat(entry)
    raise 'Unsupported runner resource' unless !attributes.symlink? && (attributes.directory? || attributes.file?)
    canonical = Pathname.new(entry).realpath.to_s
    raise 'Escaped runner resource' unless canonical == source.to_s || canonical.start_with?(source.to_s + '/')
  end
  info_path = source.join('Info.plist')
  binary = source.join('XCTRunner')
  entitlements = source.join('RunnerEntitlements.plist')
  raise 'Missing runner resources' unless info_path.lstat.file? && binary.lstat.file? && entitlements.lstat.file?
  raise 'Non-executable runner' unless (binary.stat.mode & 0111).positive? && binary.executable?
  info = Xcodeproj::Plist.read_from_path(info_path)
  raise 'Invalid runner information' unless info.is_a?(Hash) && info['CFBundlePackageType'] == 'APPL'

  destination = folder.join('StrictXCTRunner.app')
  Dir.mkdir(destination, 0700) # Exclusive: a prior or linked destination is never reused.
  FileUtils.cp_r(Dir.children(source).sort.map { |name| source.join(name) }, destination, preserve: true)
  private_info = destination.join('Info.plist')
  raise 'Invalid private runner information' unless private_info.lstat.file? && !private_info.lstat.symlink? && private_info.realpath.to_s.start_with?(destination.to_s + '/')
  strict_info = info.merge('NSAppTransportSecurity' => { 'NSAllowsArbitraryLoads' => false })
  Xcodeproj::Plist.write_to_path(strict_info, private_info)
  raise 'Runner policy was not persisted' unless Xcodeproj::Plist.read_from_path(private_info) == strict_info
  destination.to_s
rescue StandardError
  abort 'Strict XCTest runner source preparation failed'
end

abort 'Disposable macOS CI runner required' unless ENV['GITHUB_ACTIONS'] == 'true' && ENV['RUNNER_OS'] == 'macOS'
temporary = Pathname.new(ENV.fetch('RUNNER_TEMP')).realpath
folder = Pathname.new(ARGV.fetch(0)).realpath
abort 'Project must stay below RUNNER_TEMP' unless folder.to_s.start_with?(temporary.to_s + '/')
path = folder.join('AuthJourney.xcodeproj')
abort 'Runner project already exists' if path.exist?
runner_source = strict_xctrunner(folder)
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
    'XCTRUNNER_PATH' => runner_source,
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
