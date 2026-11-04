"""Host-side tests; they never create a database or an Apple simulator."""
import importlib.util
from contextlib import ExitStack
import json
import os
from pathlib import Path
import random
import shutil
import struct
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import MagicMock, patch
import zlib

BASE = Path(__file__).resolve().parent


# Real Xcodeproj generation with a synthetic Apple agent; no Apple build is performed.
RUNNER_PROJECT_FIXTURE = r'''
require 'json'
require 'digest'
require 'tmpdir'
require 'fileutils'
require 'stringio'
require 'open3'
require 'rbconfig'
require 'xcodeproj'
script, scenario = ARGV
original_popen2 = Open3.method(:popen2)

def check(value)
  raise 'Runner project fixture assertion failed' unless value
end

def tree_bytes(root)
  Dir.glob(File.join(root, '**', '*'), File::FNM_DOTMATCH).sort.select { |p| File.file?(p) && !File.symlink?(p) }.to_h do |path|
    [path.delete_prefix(root + '/'), Digest::SHA256.file(path).hexdigest]
  end
end

def descendant_state(pid, original_popen2)
  return 'reaped' if Process.waitpid(pid, Process::WNOHANG)
  'running'
rescue Errno::ECHILD
  state, status = nil, nil
  original_popen2.call('/bin/ps', '-o', 'stat=', '-p', pid.to_s, err: File::NULL) do |input, stream, child|
    input.close
    state = stream.read(33) || ''
    status = child.value
  end
  return 'absent' if status.exitstatus == 1 && state.strip.empty?
  check(status.success? && state.bytesize <= 32 && state.strip.match?(/\A[A-Z][A-Za-z<>+ -]*\z/))
  state.strip.start_with?('Z') ? 'zombie' : 'running'
end

def fixture(script, original_popen2, mutation: nil, output_kind: 'valid', wait_seconds: 0, orphan_stdout: false, aliased_tmpdir: false)
  Dir.mktmpdir('strict-runner-fixture-') do |temporary|
    original_temporary = temporary
    temporary = File.realpath(temporary)
    check(original_temporary != temporary) if aliased_tmpdir
    folder = File.join(temporary, 'private')
    platform = File.join(temporary, 'iPhoneSimulator.platform')
    agent = File.join(platform, 'Developer', 'Library', 'Xcode', 'Agents', 'XCTRunner.app')
    FileUtils.mkdir_p(folder, mode: 0700)
    FileUtils.mkdir_p(agent, mode: 0700)
    File.write(File.join(folder, 'AuthConfiguration.swift'), "enum AuthConfiguration {}\n")
    info = {'CFBundleExecutable'=>'$(WRAPPEDPRODUCTNAME)', 'CFBundleIdentifier'=>'$(WRAPPEDPRODUCTBUNDLEIDENTIFIER)', 'CFBundlePackageType'=>'APPL', 'NSAppTransportSecurity'=>{'NSAllowsArbitraryLoads'=>true, 'NSExceptionDomains'=>{'fixture.invalid'=>{'NSExceptionAllowsInsecureHTTPLoads'=>true}}}, 'fixture-data'=>['unchanged', 42, false]}
    Xcodeproj::Plist.write_to_path(info, File.join(agent, 'Info.plist'))
    Xcodeproj::Plist.write_to_path({'fixture-entitlement'=>true}, File.join(agent, 'RunnerEntitlements.plist'))
    File.binwrite(File.join(agent, 'XCTRunner'), "synthetic executable fixture\n")
    File.chmod(0700, File.join(agent, 'XCTRunner'))
    FileUtils.mkdir_p(File.join(agent, 'Resources'))
    File.write(File.join(agent, 'Resources', 'fixture.txt'), 'preserve resource')
    destination = File.join(folder, 'StrictXCTRunner.app')
    outside = File.join(temporary, 'outside')
    FileUtils.mkdir_p(outside)
    File.write(File.join(outside, 'fixture.txt'), 'outside sentinel')
    case mutation
    when 'agent-link'
      FileUtils.mv(agent, File.join(outside, 'agent'))
      File.symlink(File.join(outside, 'agent'), agent)
    when 'info-link'
      FileUtils.mv(File.join(agent, 'Info.plist'), File.join(outside, 'Info.plist'))
      File.symlink(File.join(outside, 'Info.plist'), File.join(agent, 'Info.plist'))
    when 'binary-link'
      FileUtils.mv(File.join(agent, 'XCTRunner'), File.join(outside, 'XCTRunner'))
      File.symlink(File.join(outside, 'XCTRunner'), File.join(agent, 'XCTRunner'))
    when 'resource-link'
      File.symlink(outside, File.join(agent, 'Resources', 'escape'))
    when 'missing-entitlements'
      File.unlink(File.join(agent, 'RunnerEntitlements.plist'))
    when 'non-executable'
      File.chmod(0600, File.join(agent, 'XCTRunner'))
    when 'malformed-plist'
      File.write(File.join(agent, 'Info.plist'), 'malformed fixture')
    when 'invalid-plist-type'
      File.write(File.join(agent, 'Info.plist'), "<?xml version=\"1.0\"?><plist version=\"1.0\"><array/></plist>")
    when 'existing-destination'
      Dir.mkdir(destination)
      File.write(File.join(destination, 'sentinel'), 'existing destination')
    when 'destination-link'
      File.symlink(outside, destination)
    when 'non-private-folder'
      File.chmod(0755, folder)
    end
    before = tree_bytes(platform)
    outside_before = tree_bytes(outside)
    calls, children = [], []
    descendant_file = File.join(temporary, 'owned-descendant.json')
    begin
    Open3.define_singleton_method(:popen2) do |*arguments, **options, &block|
      calls << arguments
      check(arguments == ['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-platform-path'])
      check(options[:err] == File::NULL && options[:pgroup] == true)
      output = case output_kind
      when 'empty' then ''
      when 'relative' then "relative/iPhoneSimulator.platform\n"
      when 'nul' then platform + "\x00\n"
      when 'cr' then platform + "\r\n"
      when 'multiple-lines' then platform + "\nextra\n"
      when 'oversized' then 'x' * 4097
      when 'invalid-utf8' then "\xff\n".b
      when 'wrong-platform' then outside + "\n"
      when 'missing-platform' then File.join(temporary, 'missing', 'iPhoneSimulator.platform') + "\n"
      else platform + "\n"
      end
      program = if orphan_stdout
        "require 'json'; descendant = fork { sleep 100 }; File.write(#{descendant_file.dump}, JSON.generate({'pid'=>descendant, 'pgid'=>Process.getpgrp})); exit 0"
      else
        "STDERR.write('discarded fixture stderr'); sleep(#{wait_seconds}); STDOUT.binmode; STDOUT.write(#{output.dump}); exit(#{output_kind == 'nonzero' ? 7 : 0})"
      end
      original_popen2.call(RbConfig.ruby, '-e', program, **options) do |input, stream, child|
        children << child
        block.call(input, stream, child)
      end
    end
    ENV['GITHUB_ACTIONS']='true'; ENV['RUNNER_OS']='macOS'; ENV['RUNNER_TEMP']=temporary
    ENV['XCTRUNNER_PATH']=outside
    ENV['IOS_TEST_RUNNER_ORIGIN']=outside
    ARGV.replace([folder])
    old_stdout, old_stderr = $stdout, $stderr
    $stdout, $stderr = StringIO.new, StringIO.new
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    success = false
    begin
      load script
      success = true
    rescue SystemExit => failure
      check(failure.status == 1)
    ensure
      elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      captured_error = $stderr.string
      $stdout, $stderr = old_stdout, old_stderr
    end
    check(before == tree_bytes(platform) && outside_before == tree_bytes(outside))
    check(children.all? { |child| !child.alive? })
    check(children.fetch(0).value.success?) if orphan_stdout
    check(!captured_error.include?(temporary) && !captured_error.include?('discarded fixture stderr'))
    descendant = orphan_stdout ? JSON.parse(File.read(descendant_file)) : nil
    check(descendant.keys.sort == ['pgid', 'pid'] && descendant.values.all? { |value| value.is_a?(Integer) && value > 1 } && descendant['pgid'] == children.fetch(0).pid) if descendant
    yield folder, agent, destination, info, calls, success, elapsed, descendant
    ensure
      if orphan_stdout && File.file?(descendant_file) && !(descendant && descendant['stopped'])
        owned = JSON.parse(File.read(descendant_file))
        check(owned['pgid'] == children.fetch(0).pid && owned['pid'].is_a?(Integer) && owned['pid'] > 1)
        begin
          Process.kill('KILL', owned['pid'])
        rescue Errno::ESRCH
          # It may already have terminated and been reaped by this fixture or init.
        end
        begin
          Process.waitpid(owned['pid'])
        rescue Errno::ECHILD
          # macOS init owns the orphan; the state check distinguishes zombies.
        end
      end
    end
  end
end

case scenario
when 'valid', 'valid-aliased-tmpdir'
  fixture(script, original_popen2, aliased_tmpdir: scenario == 'valid-aliased-tmpdir') do |folder, agent, destination, info, calls, success, _elapsed|
    check(success && calls.length == 1 && File.directory?(destination))
    project = Xcodeproj::Project.open(File.join(folder, 'AuthJourney.xcodeproj'))
    target = project.targets.fetch(0)
    check(target.product_type == 'com.apple.product-type.bundle.ui-testing')
    check(target.build_configurations.map(&:name).sort == ['Debug', 'Release'])
    target.build_configurations.each do |config|
      check(config.build_settings['XCTRUNNER_PATH'] == destination)
      check(config.build_settings['INFOPLIST_FILE'] == 'RunnerInfo.plist')
      check(config.build_settings['CODE_SIGNING_ALLOWED'] == 'YES' && config.build_settings['CODE_SIGN_IDENTITY'] == '-')
    end
    copied = Xcodeproj::Plist.read_from_path(File.join(destination, 'Info.plist'))
    check(copied.reject { |key, _| key == 'NSAppTransportSecurity' } == info.reject { |key, _| key == 'NSAppTransportSecurity' })
    check(copied['NSAppTransportSecurity'] == {'NSAllowsArbitraryLoads'=>false})
    check(File.binread(File.join(agent, 'XCTRunner')) == File.binread(File.join(destination, 'XCTRunner')))
    check(File.executable?(File.join(destination, 'XCTRunner')))
    check(File.binread(File.join(agent, 'RunnerEntitlements.plist')) == File.binread(File.join(destination, 'RunnerEntitlements.plist')))
    check(File.read(File.join(destination, 'Resources', 'fixture.txt')) == 'preserve resource')
  end
when 'invalid-source'
  %w[agent-link info-link binary-link resource-link missing-entitlements non-executable malformed-plist invalid-plist-type non-private-folder].each do |kind|
    fixture(script, original_popen2, mutation: kind) do |folder, _agent, _destination, _info, _calls, success, _elapsed|
      check(!success && !File.exist?(File.join(folder, 'AuthJourney.xcodeproj')))
    end
  end
when 'exclusive-destination'
  %w[existing-destination destination-link].each do |kind|
    fixture(script, original_popen2, mutation: kind) do |folder, _agent, destination, _info, _calls, success, _elapsed|
      check(!success && !File.exist?(File.join(folder, 'AuthJourney.xcodeproj')))
      check(File.read(File.join(destination, 'sentinel')) == 'existing destination') if kind == 'existing-destination'
    end
  end
when 'invalid-discovery'
  %w[nonzero empty relative nul cr multiple-lines oversized invalid-utf8 wrong-platform missing-platform].each do |kind|
    fixture(script, original_popen2, output_kind: kind) do |folder, _agent, _destination, _info, calls, success, _elapsed|
      check(!success && calls.length == 1 && !File.exist?(File.join(folder, 'AuthJourney.xcodeproj')))
    end
  end
when 'discovery-timeout'
  peer = Process.spawn(RbConfig.ruby, '-e', 'sleep 100', out: File::NULL, err: File::NULL, pgroup: true)
  peer_reaped = false
  begin
    fixture(script, original_popen2, wait_seconds: 100) do |folder, _agent, _destination, _info, calls, success, elapsed|
      check(!success && calls.length == 1 && elapsed >= 14.5 && elapsed < 18)
      check(!File.exist?(File.join(folder, 'AuthJourney.xcodeproj')))
      peer_reaped = !Process.waitpid(peer, Process::WNOHANG).nil?
      check(!peer_reaped)
    end
  ensure
    unless peer_reaped
      Process.kill('KILL', -peer)
      Process.waitpid(peer)
    end
  end
when 'orphan-discovery-timeout'
  if RUBY_PLATFORM.include?('linux')
    require 'fiddle'
    prctl = Fiddle::Function.new(Fiddle.dlopen(nil)['prctl'], [Fiddle::TYPE_INT, Fiddle::TYPE_LONG, Fiddle::TYPE_LONG, Fiddle::TYPE_LONG, Fiddle::TYPE_LONG], Fiddle::TYPE_INT)
    check(prctl.call(36, 1, 0, 0, 0) == 0) # PR_SET_CHILD_SUBREAPER; fixture process only.
  end
  peer = Process.spawn(RbConfig.ruby, '-e', 'sleep 100', out: File::NULL, err: File::NULL, pgroup: true)
  peer_reaped = false
  begin
    fixture(script, original_popen2, orphan_stdout: true) do |folder, _agent, _destination, _info, calls, success, elapsed, descendant|
      check(!success && calls.length == 1 && elapsed >= 14.5 && elapsed < 18)
      check(!File.exist?(File.join(folder, 'AuthJourney.xcodeproj')))
      check(Process.getpgid(peer) == peer && peer != descendant['pgid'])
      peer_reaped = !Process.waitpid(peer, Process::WNOHANG).nil?
      check(!peer_reaped)
      deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 1
      state = descendant_state(descendant['pid'], original_popen2)
      while state == 'running' && Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
        sleep 0.01
        state = descendant_state(descendant['pid'], original_popen2)
      end
      puts 'Owned descendant running after deadline; leader reaped and independent peer alive' if state == 'running'
      check(%w[reaped absent zombie].include?(state))
      descendant['stopped'] = true
    end
  ensure
    unless peer_reaped
      Process.kill('KILL', -peer)
      Process.waitpid(peer)
    end
  end
when 'non-child-status'
  peer = Process.spawn(RbConfig.ruby, '-e', 'sleep 100', out: File::NULL, err: File::NULL, pgroup: true)
  peer_reaped = false
  begin
    probe = Process.spawn(RbConfig.ruby, '-e', 'exit 0', out: File::NULL, err: File::NULL, pgroup: true)
    waited, probe_status = Process.wait2(probe)
    check(waited == probe && probe_status.success?)
    fixture(script, original_popen2) do |_folder, _agent, _destination, _info, calls, success, _elapsed|
      check(success && calls.length == 1)
      begin
        Process.waitpid(Process.pid, Process::WNOHANG)
        raise 'The fixture cannot be its own child'
      rescue Errno::ECHILD
        # Exercise the real non-child branch even on a Linux host with subreaping.
      end
      check(descendant_state(Process.pid, original_popen2) == 'running')
      check(descendant_state(probe, original_popen2) == 'absent')
      rejected = false
      begin
        Open3.popen2('/fixture/unexpected-discovery-command', err: File::NULL, pgroup: true) { raise 'Unexpected fixture command executed' }
      rescue RuntimeError => failure
        rejected = failure.message == 'Runner project fixture assertion failed'
      end
      check(rejected && calls.length == 2 && calls.last == ['/fixture/unexpected-discovery-command'])
      peer_reaped = !Process.waitpid(peer, Process::WNOHANG).nil?
      check(!peer_reaped)
    end
  ensure
    unless peer_reaped
      Process.kill('KILL', -peer)
      Process.waitpid(peer)
    end
  end
else
  raise 'Unknown runner project fixture scenario'
end
puts JSON.generate({'scenario'=>scenario, 'passed'=>true, 'ruby'=>RUBY_VERSION, 'xcodeproj'=>Xcodeproj::VERSION, 'nativeBuild'=>false})
'''


class RunnerProjectGenerationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ruby = shutil.which("ruby")
        cls.unavailable = None
        if os.name == "nt" or not cls.ruby:
            cls.unavailable = "POSIX Ruby/Xcodeproj unavailable; real generator requires its separate Ruby fixture"
            return
        cls.environment = dict(os.environ)
        cls.bootstrap = "require 'xcodeproj'; load ARGV.shift"
        probe = subprocess.run([cls.ruby, "-e", "require 'xcodeproj'"], env=cls.environment, capture_output=True, timeout=15)
        if probe.returncode != 0:
            cls.environment["BUNDLE_GEMFILE"] = str(BASE.parent.parent / "apps/resident-mobile/Gemfile")
            probe = subprocess.run([cls.ruby, "-e", "require 'bundler/setup'; require 'xcodeproj'"], env=cls.environment, capture_output=True, timeout=15)
            if probe.returncode != 0:
                cls.unavailable = "Configured Xcodeproj gem unavailable; no automatic dependency installation"
                return
            cls.bootstrap = "require 'bundler/setup'; require 'xcodeproj'; load ARGV.shift"

    def run_fixture(self, scenario, *, aliased_tmpdir=False):
        if self.unavailable:
            self.skipTest(self.unavailable)
        with tempfile.TemporaryDirectory() as temporary:
            fixture = Path(temporary) / "runner-fixture.rb"
            fixture.write_text(RUNNER_PROJECT_FIXTURE, encoding="utf-8")
            environment = dict(self.environment)
            if aliased_tmpdir:
                actual = Path(temporary) / "actual-tmpdir"
                actual.mkdir()
                alias = Path(temporary) / "aliased-tmpdir"
                alias.symlink_to(actual, target_is_directory=True)
                environment["TMPDIR"] = str(alias)
            response = subprocess.run([self.ruby, "-e", self.bootstrap, str(fixture), str(BASE / "project.rb"), scenario],
                                      env=environment, capture_output=True, text=True, timeout=45)
        failure = "Real runner project fixture failed; captured output remains private"
        marker = "Owned descendant running after deadline; leader reaped and independent peer alive"
        if scenario == "orphan-discovery-timeout" and response.stdout == marker + "\n":
            failure = marker
        self.assertEqual(response.returncode, 0, failure)
        report = json.loads(response.stdout)
        self.assertEqual(report["scenario"], scenario)
        self.assertIs(report["passed"], True)
        self.assertIs(report["nativeBuild"], False)

    def test_generated_configs_bind_private_strict_origin_and_preserve_source(self):
        self.run_fixture("valid")

    def test_generated_configs_use_canonical_private_origin_under_aliased_tmpdir(self):
        self.run_fixture("valid-aliased-tmpdir", aliased_tmpdir=True)

    def test_non_child_status_probe_keeps_discovery_mock_strict_and_independent_peer_alive(self):
        self.run_fixture("non-child-status")

    def test_source_links_missing_resources_and_malformed_plists_fail_closed(self):
        self.run_fixture("invalid-source")

    def test_private_destination_is_exclusive_and_never_overwrites(self):
        self.run_fixture("exclusive-destination")

    def test_fixed_discovery_rejects_invalid_outputs_and_does_not_use_environment_origin(self):
        self.run_fixture("invalid-discovery")

    def test_discovery_timeout_terminates_only_owned_child(self):
        self.run_fixture("discovery-timeout")

    def test_discovery_timeout_terminates_owned_descendant_after_leader_exits(self):
        self.run_fixture("orphan-discovery-timeout")


def png_fixture():
    def chunk(kind, contents):
        return struct.pack(">I", len(contents)) + kind + contents + struct.pack(">I", zlib.crc32(kind + contents))
    random_bytes = random.Random(2)
    pixels = b"".join(b"\x00" + random_bytes.randbytes(32 * 3) for _ in range(32))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 32, 32, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def load(name):
    spec = importlib.util.spec_from_file_location("ios_" + name, BASE / (name + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ConfigurationTests(unittest.TestCase):
    def test_closed_origin_and_exact_source(self):
        prepare = load("prepare_auth")
        source = 'const PRODUCTION_API_URL = "";\n'
        self.assertEqual(prepare.configure_source(source), 'const PRODUCTION_API_URL = "https://127.0.0.1:3443";\n')
        for invalid in [source + source, "const PRODUCTION_API_URL = endpoint;"]:
            with self.assertRaises(ValueError):
                prepare.configure_source(invalid)

    def test_temp_and_ci_guards_precede_changes(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            good = {"GITHUB_ACTIONS": "true", "RUNNER_OS": "macOS", "RUNNER_TEMP": temporary}
            self.assertEqual(prepare.disposable_path(root / "auth", good), (root / "auth").resolve())
            for env in [{**good, "GITHUB_ACTIONS": "false"}, {**good, "RUNNER_OS": "Windows"}]:
                with self.assertRaises(ValueError):
                    prepare.disposable_path(root / "auth", env)
            for path in [root, root.parent / "personal", root / ".." / "personal"]:
                with self.assertRaises(ValueError):
                    prepare.disposable_path(path, good)


class OpenSSLSelectionTests(unittest.TestCase):
    def executable(self, root):
        binary = root / "openssl"
        binary.write_text("fixture")
        binary.chmod(0o755)
        return binary.resolve()

    def responses(self, version="OpenSSL 3.0.13 30 Jan 2024"):
        def respond(arguments, **_kwargs):
            if arguments[1:] == ["version"]:
                return subprocess.CompletedProcess(arguments, 0, version, "")
            return subprocess.CompletedProcess(arguments, 0, "", "-verify_ip -CAfile -addext -extfile -req")
        return respond

    def test_exact_executable_is_used_for_version_and_required_capabilities(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            binary = self.executable(Path(temporary))
            with patch.object(prepare.subprocess, "run", side_effect=self.responses()) as run:
                tool = prepare.choose_openssl(binary)
            self.assertEqual(tool["version"], "3.0.13")
            self.assertEqual(tool["binary"], str(binary))
            self.assertEqual([call.args[0][0] for call in run.call_args_list], [str(binary)] * 4)

    def test_missing_or_relative_executable_never_falls_back_to_path(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(prepare.subprocess, "run") as run:
                for binary in [None, Path("openssl"), Path("missing/openssl"), Path(temporary) / "missing"]:
                    with self.assertRaises(ValueError):
                        prepare.choose_openssl(binary)
                run.assert_not_called()

    def test_libressl_old_or_future_openssl_are_rejected_without_echoing_output(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            binary = self.executable(Path(temporary))
            for version in ["LibreSSL 3.3.6 SENTINEL_SECRET", "OpenSSL 1.1.1 SENTINEL_SECRET", "OpenSSL 4.0.0 SENTINEL_SECRET", "unexpected SENTINEL_SECRET"]:
                with patch.object(prepare.subprocess, "run", side_effect=self.responses(version)):
                    with self.assertRaises(RuntimeError) as failure:
                        prepare.choose_openssl(binary)
                self.assertNotIn("SENTINEL_SECRET", str(failure.exception))

    def test_missing_verify_ip_or_addext_is_terminal(self):
        prepare = load("prepare_auth")
        with tempfile.TemporaryDirectory() as temporary:
            binary = self.executable(Path(temporary))
            for flags in ["-CAfile -addext -extfile -req", "-CAfile -verify_ip -extfile -req"]:
                def response(arguments, **_kwargs):
                    return subprocess.CompletedProcess(arguments, 0, "OpenSSL 3.0.13" if arguments[1] == "version" else "", flags)
                with patch.object(prepare.subprocess, "run", side_effect=response), self.assertRaises(RuntimeError):
                    prepare.choose_openssl(binary)

    def test_tls_failure_reports_category_stage_and_code_without_raw_stderr(self):
        prepare = load("prepare_auth")
        failure = subprocess.CalledProcessError(2, ["/explicit/openssl", "verify", "-CAfile", "private"],
                                               stderr=b"verify: Unknown option -verify_ip SENTINEL_SECRET")
        message = prepare.tls_failure(failure, "3.0.13")
        self.assertIn("verify", message)
        self.assertIn("unsupported-option", message)
        self.assertIn("exit=2", message)
        self.assertNotIn("SENTINEL_SECRET", message)
        self.assertNotIn("/explicit", message)

    def test_real_tls_keeps_ip_ca_and_chain_verification(self):
        prepare = load("prepare_auth")
        if sys.platform == "darwin":
            binary = Path(subprocess.check_output(["brew", "--prefix", "openssl@3"], text=True).strip()) / "bin/openssl"
        else:
            selected = shutil.which("openssl")
            if sys.platform == "win32" and not selected:
                self.skipTest("OpenSSL is not installed in the Windows host")
            self.assertIsNotNone(selected, "Linux TLS verification requires real OpenSSL")
            binary = Path(selected)
        tool = prepare.choose_openssl(binary)
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            actual_run = subprocess.run
            with patch.object(prepare.subprocess, "run", wraps=actual_run) as commands:
                ca = prepare.create_ios_certificates(directory / "tls", tool)
            self.assertEqual(len(commands.call_args_list), 5)
            self.assertEqual([call.args[0][0] for call in commands.call_args_list], [tool["binary"]] * 5)
            for endpoint in ["10.0.2.2", "127.0.0.1"]:
                verified = subprocess.run([tool["binary"], "verify", "-CAfile", str(ca), "-verify_ip", endpoint, str(directory / "tls/server.pem")], capture_output=True)
                self.assertEqual(verified.returncode, 0)
            for endpoint in ["127.0.0.2", "192.0.2.1"]:
                rejected = subprocess.run([tool["binary"], "verify", "-CAfile", str(ca), "-verify_ip", endpoint, str(directory / "tls/server.pem")], capture_output=True)
                self.assertNotEqual(rejected.returncode, 0)
            other_ca = prepare.create_ios_certificates(directory / "other", tool)
            rejected = subprocess.run([tool["binary"], "verify", "-CAfile", str(other_ca), "-verify_ip", "127.0.0.1", str(directory / "tls/server.pem")], capture_output=True)
            self.assertNotEqual(rejected.returncode, 0)


class ExportTests(unittest.TestCase):
    def test_png_magic_is_not_sufficient_for_a_real_native_image(self):
        run = load("run_auth")
        valid = png_fixture()
        for invalid in [b"\x89PNG\r\n\x1a\n" + b"x" * 1024, valid[:-1], valid + b"secret tail",
                        valid[:24] + bytes([valid[24] ^ 1]) + valid[25:]]:
            with self.subTest(size=len(invalid)), self.assertRaises(run.SecurityViolation):
                run.validate_png(invalid)
        self.assertEqual(run.validate_png(valid), (32, 32))

    def test_export_rejects_credentials_even_when_truncated(self):
        run = load("run_auth")
        secrets = [" OldPassword123456789 ", " NewPassword987654321 "]
        for value in [secrets[0], secrets[1], "OldPassword123", "NewPassword987", "eyJabcdefghijklmnop.qwertyuiopasdf.zxcvbnmasdfgh", "a" * 64]:
            with self.subTest(value=value), self.assertRaises(run.SecurityViolation):
                run.reject_secrets(value, secrets)

    def test_allowlist_rejects_unknown_keys_and_filenames(self):
        run = load("run_auth")
        with self.assertRaises(run.SecurityViolation):
            run.safe_snapshot({"resident-mobile": {"password": "hidden"}})
        for filename in ["xcresult", "fixture.json", "phase.xml", "01-login.png/../secret", "token.log"]:
            with self.assertRaises(run.SecurityViolation):
                run.evidence_filename(filename)

    def test_exact_snapshot_counts_and_no_new_family_on_restore(self):
        run = load("run_auth")
        expected = run.counts("restored")
        self.assertEqual(expected, {"sessions": 1, "active_sessions": 1, "logouts": 0,
                                   "refresh_tokens": 2, "rotations": 1, "live_refresh_tokens": 1})
        self.assertEqual(run.counts("changed")["active_sessions"], 0)
        self.assertEqual(run.counts("logout")["sessions"], 2)

    def test_privacy_failure_is_first_and_blocks_both_collectors(self):
        run = load("run_auth")
        gate = run.EvidenceGate()
        gate.reject("private-identity")
        gate.reject("credential-exposure")
        self.assertEqual(gate.failure["kind"], "private-identity")
        for app in run.APPS:
            with self.assertRaises(run.SecurityViolation):
                gate.require_open()
        self.assertEqual(set(gate.failure), {"kind", "observedAt"})

    def test_phase_payload_is_closed_and_contains_only_booleans(self):
        run = load("run_auth")
        valid = {"app": "resident-mobile", "phase": "01-login", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.assertEqual(run.safe_checkpoint(valid), valid)
        for invalid in [{**valid, "tree": "secret"}, {**valid, "phase": "unknown"},
                        {**valid, "checks": {"privacy": True, "screen": "password", "secure": True}}]:
            with self.assertRaises(run.SecurityViolation):
                run.safe_checkpoint(invalid)

    def test_invalid_artifact_never_creates_public_staging(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            (private / "fixture.json").write_text('{"password":"Secret123456789"}')
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, ["Secret123456789"])
            self.assertFalse(public.exists())

    def test_known_filename_cannot_smuggle_an_extra_json_field(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            (private / "builds.json").write_text('[{"token":"eyJabcdefghijklmnop.qwertyuiopasdf.zxcvbnmasdfgh"}]')
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, [])
            self.assertFalse(public.exists())

    def test_known_token_cannot_hide_in_a_valid_sha_field(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            token = "a" * 64
            builds = [{"app": app, "bundleId": bundle, "mode": "Release", "sha256": token} for app, bundle in run.APPS.items()]
            (private / "builds.json").write_text(json.dumps(builds))
            result = {"passed": False, "scope": run.SCOPE, "commit": "b" * 40,
                      "runtime": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "sdkVersion": "18.5", "steps": []}
            (private / "result.json").write_text(json.dumps(result))
            with self.assertRaises(run.SecurityViolation):
                run.export_evidence(private, public, [token])
            self.assertFalse(public.exists())

    def test_safe_partial_failure_exports_only_the_closed_schema(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            private, public = root / "private", root / "public"
            private.mkdir()
            builds = [{"app": app, "bundleId": bundle, "mode": "Release", "sha256": "a" * 64} for app, bundle in run.APPS.items()]
            (private / "builds.json").write_text(json.dumps(builds))
            result = {"passed": False, "scope": run.SCOPE, "commit": "b" * 40,
                      "runtime": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "sdkVersion": "18.5", "steps": [],
                      "failureKind": "native-journey-failed"}
            (private / "result.json").write_text(json.dumps(result))
            run.export_evidence(private, public, ["NewSecret123456789"])
            self.assertEqual({path.name for path in public.iterdir()}, {"builds.json", "result.json"})

    def test_simulator_selector_never_uses_booted_or_personal_uuid(self):
        run = load("run_auth")
        for invalid in ["booted", "all", "personal-phone", "00000000-0000-0000-0000-000000000000"]:
            with self.assertRaises(ValueError):
                run.owned_simulator(invalid, None)
        value = "f19ce90e-9c36-461d-a499-692ff2570a01"
        self.assertEqual(run.owned_simulator(value, value), value)

    def test_owned_simulator_preserves_producer_spelling_for_the_same_identity(self):
        run = load("run_auth")
        lower = "f19ce90e-9c36-461d-a499-692ff2570a01"
        for created in [lower, lower.upper(), "F19ce90E-9c36-461D-a499-692fF2570A01"]:
            with self.subTest(spelling=created):
                self.assertEqual(run.owned_simulator(created, created), created)
                self.assertEqual(run.owned_simulator(lower, created), created)
                self.assertEqual(run.owned_simulator(lower.upper(), created), created)

    def test_owned_simulator_rejects_noncanonical_foreign_and_nil_selectors(self):
        run = load("run_auth")
        created = "f19ce90e-9c36-461d-a499-692ff2570a01"
        invalid = [None, True, 1, run.uuid.UUID(created), "", "booted", "all", "personal-phone",
                   "00000000-0000-0000-0000-000000000000", "f19ce90e-9c36-461d-a499-692ff2570a02",
                   created.replace("-", ""), "{" + created + "}", "urn:uuid:" + created,
                   " " + created, created + " ", created + "\n", created + "\r", created + "\t",
                   created + "\0", created.replace("-", "\u2010", 1)]
        for index, value in enumerate(invalid):
            with self.subTest(position="selector", case=index, value_type=type(value).__name__):
                with self.assertRaises(ValueError):
                    run.owned_simulator(value, created)
            with self.subTest(position="created", case=index, value_type=type(value).__name__):
                with self.assertRaises(ValueError):
                    run.owned_simulator(created, value)


class NativeFailureDiagnosticTests(unittest.TestCase):
    def run_failure(self, failed_stage, *, cleanup_fails=False, rejection=None, outcome="nonzero-exit",
                    build_message=None, created_id=None, command_trace=None, coordinator_trace=None,
                    runner_policy=None, ats_observer_fails=False):
        run = load("run_auth")
        secret = "PrivateNativeDiagnosticSentinel123456"
        with tempfile.TemporaryDirectory() as temporary, ExitStack() as patches:
            root = Path(temporary)
            private = root / "private"
            private.mkdir()
            (private / "secrets.json").write_text(json.dumps({"IOS_AUTH_COORDINATOR_TOKEN": secret}))
            (private / "fixture.json").write_text("{}")
            database = root / "database"
            database.mkdir()
            (database / "source-versions.json").write_text(json.dumps({
                "postgres": "16.15", "timescale": "2.17.2",
                "postgresSha256": "c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed",
                "timescaleSha256": "85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb"}))
            applications = []
            for product, bundle in run.APPS.items():
                application = root / (product + ".app")
                application.mkdir()
                with (application / "Info.plist").open("wb") as destination:
                    run.plistlib.dump({"CFBundleIdentifier": bundle, "CFBundleExecutable": "Product"}, destination)
                (application / "Product").write_bytes(product.encode())
                applications.append(application)
            runner_info = private / "runner-build/Build/Products/Release-iphonesimulator/AuthJourney-Runner.app/Info.plist"
            runner_info.parent.mkdir(parents=True)
            with runner_info.open("wb") as destination:
                run.plistlib.dump({} if runner_policy is None else runner_policy, destination)
            simulator = created_id if created_id is not None else "f19ce90e-9c36-461d-a499-692ff2570a01"
            runtime = "com.apple.CoreSimulator.SimRuntime.iOS-18-5"
            stages = []
            coordinators = []
            original_coordinator = run.Coordinator

            def coordinator(*arguments):
                item = original_coordinator(*arguments)
                coordinators.append(item)
                if coordinator_trace is not None:
                    coordinator_trace.append(item.simulator)
                return item

            def respond(arguments, **options):
                if command_trace is not None:
                    command_trace.append((arguments, options["timeout"]))
                stage = None
                if arguments[:3] == ("xcrun", "simctl", "create"):
                    stdout = simulator
                elif arguments[:3] == ("xcrun", "simctl", "list"):
                    stdout = "{}"
                elif arguments[:3] == ("xcrun", "simctl", "bootstatus"):
                    stage, stdout = "simulator-boot", ""
                    self.assertEqual(options["timeout"], 180)
                elif arguments[:3] == ("xcrun", "simctl", "install"):
                    stage, stdout = ("resident-install" if "resident-mobile" in arguments[-1] else "operations-install"), ""
                    self.assertEqual(options["timeout"], 120)
                elif arguments[0] == "xcodebuild":
                    stage = "runner-build" if "build-for-testing" in arguments else "runner-test"
                    stdout = ""
                    self.assertEqual(options["timeout"], 240 if stage == "runner-build" else 1200)
                    if rejection and stage == "runner-test":
                        if rejection == "phase":
                            coordinators[0].error_kind = "phase-rejected"
                        else:
                            coordinators[0].gate.reject("private-identity")
                            coordinators[0].gate.reject("credential-exposure")
                            if rejection == "security-and-phase":
                                coordinators[0].error_kind = "phase-rejected"
                elif arguments[:3] == ("xcrun", "simctl", "shutdown"):
                    stage, stdout = "simulator-shutdown", ""
                elif arguments[:3] == ("xcrun", "simctl", "delete"):
                    stage, stdout = "simulator-delete", ""
                elif arguments[:2] == ("xcrun", "otool"):
                    stdout = "sectname __entitlements"
                elif arguments[:3] == ("xcrun", "--sdk", "iphonesimulator"):
                    stdout = "18.5"
                else:
                    stdout = ""
                if stage:
                    stages.append(stage)
                if stage == failed_stage:
                    if outcome == "returns-incomplete":
                        return subprocess.CompletedProcess(arguments, 0, "", "")
                    if outcome == "timed-out":
                        raise subprocess.TimeoutExpired(arguments, options["timeout"], output=secret, stderr=secret)
                    if outcome == "unavailable":
                        raise OSError(secret)
                    return subprocess.CompletedProcess(arguments, 65, secret,
                                                       build_message if stage == "runner-build" and build_message is not None else secret)
                if cleanup_fails and stage in {"simulator-shutdown", "simulator-delete"}:
                    return subprocess.CompletedProcess(arguments, 42, secret, secret)
                return subprocess.CompletedProcess(arguments, 0, stdout, "")

            patches.enter_context(patch.object(run, "ROOT", root))
            patches.enter_context(patch.object(run, "disposable_path", return_value=private))
            patches.enter_context(patch.object(run, "simulator_product", side_effect=lambda info: info["CFBundleIdentifier"]))
            patches.enter_context(patch.object(run, "iphone_target", return_value=(runtime, "fixed-fixture-device")))
            patches.enter_context(patch.object(run, "Coordinator", side_effect=coordinator))
            patches.enter_context(patch.object(run, "ThreadingHTTPServer", return_value=MagicMock()))
            patches.enter_context(patch.object(run.ssl, "SSLContext", return_value=MagicMock()))
            patches.enter_context(patch.object(run.threading, "Thread", return_value=MagicMock()))
            patches.enter_context(patch.object(run.subprocess, "run", side_effect=respond))
            if ats_observer_fails:
                patches.enter_context(patch.object(run, "runner_ats_policy", side_effect=OSError(secret)))
            patches.enter_context(patch.dict(run.os.environ, {"GITHUB_SHA": "b" * 40, "IOS_DB_ROOT": str(database),
                                                           "GITHUB_OUTPUT": str(root / "outputs")}))
            output = root / ".local/ios-auth/evidence"
            with self.assertRaises(SystemExit) as failure:
                run.run(private, output, *applications)
            self.assertNotIn(secret, str(failure.exception))
            result = json.loads((output / "result.json").read_text())
            self.assertNotIn(secret, json.dumps(result))
            self.assertFalse(result["passed"])
            self.assertEqual(result["steps"], [])
            self.assertEqual({item.name for item in output.iterdir()}, {"result.json", "builds.json", "database-source.json"})
            if failed_stage == "runner-ats-check":
                self.assertEqual(result["failureDiagnostic"]["stage"], failed_stage)
            else:
                self.assertIn(failed_stage, stages)
            return result, stages

    def test_boot_failure_reports_the_boot_stage(self):
        result, stages = self.run_failure("simulator-boot")
        self.assertEqual(result.get("failureDiagnostic"), {"stage": "simulator-boot", "category": "nonzero-exit", "exitCode": 65})
        self.assertNotIn("resident-install", stages)

    def test_each_product_install_failure_is_identified(self):
        for stage in ["resident-install", "operations-install"]:
            with self.subTest(stage=stage):
                result, stages = self.run_failure(stage)
                self.assertEqual(result.get("failureDiagnostic"), {"stage": stage, "category": "nonzero-exit", "exitCode": 65})
                self.assertNotIn("runner-build", stages)

    def test_runner_build_failure_does_not_claim_xctest_started(self):
        result, stages = self.run_failure("runner-build")
        self.assertEqual(result.get("failureDiagnostic"), {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 65,
                                                         "errorSignals": ["unclassified"], "signalScanLimited": False})
        self.assertNotIn("runner-test", stages)

    def test_runner_build_call_explicitly_observes_signals_and_keeps_original_gate(self):
        result, stages = self.run_failure("runner-build", build_message=RunnerBuildSignalTests.destination,
                                          cleanup_fails=True)
        self.assertEqual(result.get("failureDiagnostic"), {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 65,
                                                         "errorSignals": ["destination-selection"], "signalScanLimited": False})
        self.assertTrue(result["cleanupFailed"])
        self.assertNotIn("runner-test", stages)

    def test_runner_test_failure_is_distinct_from_build(self):
        result, stages = self.run_failure("runner-test")
        self.assertEqual(result.get("failureDiagnostic"), {"stage": "runner-test", "category": "nonzero-exit", "exitCode": 65})
        self.assertIn("runner-build", stages)

    def test_ats_guard_failure_is_closed_and_precedes_test_and_cleanup(self):
        secret = "PrivateATSDomainSentinel123456"
        cases = [
            ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}}, ats_policy(arbitrary="bool", enabled=True)),
            ({"NSAppTransportSecurity": {"NSExceptionDomains": {secret: {"private": secret}}}}, ats_policy(domains="dict", count=1)),
            ({"NSAppTransportSecurity": True}, ats_policy(ats="bool", arbitrary="unavailable", domains="unavailable")),
            ({"NSAppTransportSecurity": False}, ats_policy(ats="bool", arbitrary="unavailable", domains="unavailable")),
            ({"NSAppTransportSecurity": secret}, ats_policy(ats="invalid", arbitrary="unavailable", domains="unavailable")),
            ([], ats_policy(ats="unavailable", arbitrary="unavailable", domains="unavailable")),
        ]
        for index, (plist, policy) in enumerate(cases):
            with self.subTest(case=index):
                result, stages = self.run_failure("runner-ats-check", runner_policy=plist, cleanup_fails=True)
                self.assertEqual(result["failureDiagnostic"], {"stage": "runner-ats-check", "category": "verification-failed",
                                                              "exitCode": None, "atsPolicy": policy})
                self.assertTrue(result["cleanupFailed"])
                self.assertIn("runner-build", stages)
                self.assertNotIn("runner-test", stages)
                self.assertNotIn(secret, json.dumps(result))

    def test_safe_ats_configs_keep_existing_gate_and_never_collect_on_success(self):
        for plist in [{}, {"NSAppTransportSecurity": {}},
                      {"NSAppTransportSecurity": {"NSAllowsLocalNetworking": True}},
                      {"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": False, "NSExceptionDomains": {}}}]:
            with self.subTest(plist=plist):
                result, stages = self.run_failure("runner-test", runner_policy=plist, ats_observer_fails=True)
                self.assertEqual(result["failureDiagnostic"], {"stage": "runner-test", "category": "nonzero-exit", "exitCode": 65})
                self.assertIn("runner-test", stages)

    def test_failed_ats_observer_omits_only_supplement_and_preserves_first_gate(self):
        result, stages = self.run_failure("runner-ats-check", runner_policy={"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}},
                                          ats_observer_fails=True, cleanup_fails=True)
        self.assertEqual(result["failureDiagnostic"], {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None})
        self.assertTrue(result["cleanupFailed"])
        self.assertNotIn("runner-test", stages)

    def test_created_simulator_spelling_reaches_all_owned_commands_and_coordinator(self):
        lower = "f19ce90e-9c36-461d-a499-692ff2570a01"
        for producer in [lower.upper(), "F19ce90E-9c36-461D-a499-692fF2570A01", lower]:
            with self.subTest(spelling=producer):
                commands, coordinator = [], []
                result, stages = self.run_failure("runner-test", created_id=producer,
                                                  command_trace=commands, coordinator_trace=coordinator)
                self.assertEqual(result["failureDiagnostic"], {"stage": "runner-test", "category": "nonzero-exit", "exitCode": 65})
                self.assertEqual(sum(args[:3] == ("xcrun", "simctl", "create") for args, _ in commands), 1)
                owned = [(args, timeout) for args, timeout in commands
                         if args[:2] == ("xcrun", "simctl") and args[2] in
                         {"bootstatus", "keychain", "install", "shutdown", "delete"}]
                self.assertEqual([args[2] for args, _ in owned], ["bootstatus", "keychain", "install", "install", "shutdown", "delete"])
                for args, timeout in owned:
                    with self.subTest(action=args[2]):
                        self.assertEqual(args[3], producer)
                    if args[2] in {"shutdown", "delete"}:
                        self.assertEqual(timeout, 60)
                builds = [(args, timeout) for args, timeout in commands if args[0] == "xcodebuild"]
                self.assertEqual(len(builds), 2)
                self.assertEqual([timeout for _, timeout in builds], [240, 1200])
                self.assertIn("build-for-testing", builds[0][0])
                self.assertIn("test-without-building", builds[1][0])
                for args, _ in builds:
                    with self.subTest(action="build-for-testing" if "build-for-testing" in args else "test-without-building"):
                        self.assertEqual(args[args.index("-destination") + 1], "platform=iOS Simulator,id=" + producer)
                self.assertEqual(coordinator, [producer])
                self.assertEqual(stages[-2:], ["simulator-shutdown", "simulator-delete"])

    def test_device_destination_failure_preserves_owned_cleanup_and_first_failure(self):
        producer = "F19CE90E-9C36-461D-A499-692FF2570A01"
        commands = []
        result, stages = self.run_failure("runner-build", cleanup_fails=True, created_id=producer,
                                          build_message=RunnerBuildSignalTests.device_destination, command_trace=commands)
        self.assertEqual(result["failureDiagnostic"], {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 65,
                                                      "errorSignals": ["destination-selection"], "signalScanLimited": False})
        self.assertTrue(result["cleanupFailed"])
        self.assertNotIn("runner-test", stages)
        cleanup = [(args, timeout) for args, timeout in commands
                   if args[:2] == ("xcrun", "simctl") and args[2] in {"shutdown", "delete"}]
        self.assertEqual([args[2] for args, _ in cleanup], ["shutdown", "delete"])
        for args, timeout in cleanup:
            self.assertEqual(args[3], producer)
            self.assertEqual(timeout, 60)

    def test_cleanup_cannot_overwrite_the_first_failure(self):
        result, stages = self.run_failure("runner-build", cleanup_fails=True)
        self.assertEqual(result.get("failureDiagnostic"), {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 65,
                                                         "errorSignals": ["unclassified"], "signalScanLimited": False})
        self.assertTrue(result["cleanupFailed"])
        self.assertEqual(stages[-2:], ["simulator-shutdown", "simulator-delete"])

    def test_timeout_and_unavailable_do_not_echo_the_original_error(self):
        for outcome in ["timed-out", "unavailable"]:
            with self.subTest(outcome=outcome):
                result, _stages = self.run_failure("runner-test", outcome=outcome)
                self.assertEqual(result.get("failureDiagnostic"), {"stage": "runner-test", "category": outcome, "exitCode": None})

    def test_security_and_phase_rejections_remain_primary(self):
        for rejection in ["security", "phase", "security-and-phase"]:
            with self.subTest(rejection=rejection):
                result, _stages = self.run_failure("runner-test", rejection=rejection, cleanup_fails=True)
                self.assertEqual(result["failureKind"], "phase-rejected" if rejection == "phase" else "security-rejection")
                self.assertNotIn("failureDiagnostic", result)
                if rejection != "phase":
                    self.assertEqual(result["securityFailure"]["kind"], "private-identity")

    def test_successful_runner_command_cannot_approve_an_incomplete_journey(self):
        result, _stages = self.run_failure("runner-test", outcome="returns-incomplete")
        self.assertEqual(result["failureDiagnostic"], {"stage": "journey-finish-check", "category": "verification-failed", "exitCode": None})

    def test_diagnostic_failure_preserves_the_original_exception_object(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        original = RuntimeError("PrivateDiagnosticSentinel123456")
        with patch.object(run, "safe_failure_diagnostic", side_effect=OSError("private collector failure")):
            with self.assertRaises(RuntimeError) as observed:
                with diagnostic.stage("runner-test"):
                    raise original
        self.assertIs(observed.exception, original)
        self.assertIsNone(diagnostic.first)

    def test_failed_first_observation_cannot_relabel_cleanup_as_the_first_failure(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        original = RuntimeError("private first failure")
        with patch.object(run, "safe_failure_diagnostic", side_effect=OSError("private collector failure")):
            with self.assertRaises(RuntimeError) as observed:
                with diagnostic.stage("runner-build"):
                    raise original
        self.assertIs(observed.exception, original)
        with self.assertRaises(RuntimeError):
            with diagnostic.stage("simulator-delete"):
                raise RuntimeError("private cleanup failure")
        self.assertIsNone(diagnostic.first)

    def test_real_subprocess_exit_timeout_and_missing_executable_are_closed(self):
        run = load("run_auth")
        secret = "PrivateRealProcessSentinel123456"
        with tempfile.TemporaryDirectory() as temporary:
            cases = [
                ((sys.executable, "-c", "import sys; print(sys.argv[1]); sys.stderr.write(sys.argv[1]); sys.exit(23)", secret),
                 5, "nonzero-exit", 23),
                ((sys.executable, "-c", "import time; time.sleep(60)"), 0.15, "timed-out", None),
                ((str(Path(temporary) / "missing-executable"), secret), 5, "unavailable", None),
            ]
            for arguments, timeout, category, code in cases:
                with self.subTest(category=category):
                    diagnostic = run.FailureDiagnostic()
                    with self.assertRaises(RuntimeError) as observed:
                        with diagnostic.stage("runner-test"):
                            run.command(*arguments, timeout=timeout)
                    self.assertEqual(diagnostic.first, {"stage": "runner-test", "category": category, "exitCode": code})
                    self.assertNotIn(secret, str(observed.exception))
                    self.assertNotIn(secret, json.dumps(diagnostic.first))

    def test_real_success_preserves_stdout_private_capture_and_has_no_failure(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / "private.log"
            with diagnostic.stage("runner-build"):
                output = run.command(sys.executable, "-c", "import sys; print(' kept '); sys.stderr.write('private-stderr')",
                                     timeout=5, private_log=log)
            self.assertEqual(output, "kept")
            self.assertEqual(log.read_text(), " kept \nprivate-stderr")
            self.assertIsNone(diagnostic.first)

    def test_signal_exit_is_bounded_without_fabricating_a_positive_status(self):
        run = load("run_auth")
        for status, expected in [(-15, -15), (255, 255), (256, None), (-256, None)]:
            with self.subTest(status=status):
                diagnostic = run.FailureDiagnostic()
                response = subprocess.CompletedProcess(["fixture"], status, "private", "private")
                with patch.object(run.subprocess, "run", return_value=response), self.assertRaises(RuntimeError):
                    with diagnostic.stage("runner-test"):
                        run.command("fixture")
                self.assertEqual(diagnostic.first["exitCode"], expected)


def ats_policy(*, ats="dict", arbitrary="absent", enabled=None, domains="absent", count=None):
    return {"atsKind": ats, "arbitraryLoadsKind": arbitrary, "arbitraryLoadsEnabled": enabled,
            "exceptionDomainsKind": domains, "exceptionDomainCountCapped": count}


class RunnerATSDiagnosticTests(unittest.TestCase):
    def test_exact_types_and_absence_are_distinct_without_free_values(self):
        run = load("run_auth")
        secret = "PrivateATSDomainSentinel123456"
        cases = [({}, ats_policy(ats="absent", arbitrary="unavailable", domains="unavailable")),
                 ([], ats_policy(ats="unavailable", arbitrary="unavailable", domains="unavailable")),
                 ({"NSAppTransportSecurity": True}, ats_policy(ats="bool", arbitrary="unavailable", domains="unavailable")),
                 ({"NSAppTransportSecurity": {}}, ats_policy()),
                 ({"NSAppTransportSecurity": secret}, ats_policy(ats="invalid", arbitrary="unavailable", domains="unavailable")),
                 ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": False}}, ats_policy(arbitrary="bool", enabled=False)),
                 ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": True}}, ats_policy(arbitrary="bool", enabled=True)),
                 ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": {}}}, ats_policy(arbitrary="dict")),
                 ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": secret}}, ats_policy(arbitrary="invalid")),
                 ({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": 1}}, ats_policy(arbitrary="invalid")),
                 ({"NSAppTransportSecurity": {"NSExceptionDomains": {}}}, ats_policy(domains="dict", count=0)),
                 ({"NSAppTransportSecurity": {"NSExceptionDomains": {secret: {"private": secret}}}}, ats_policy(domains="dict", count=1)),
                 ({"NSAppTransportSecurity": {"NSExceptionDomains": True}}, ats_policy(domains="bool")),
                 ({"NSAppTransportSecurity": {"NSExceptionDomains": secret}}, ats_policy(domains="invalid")),
                 ({"NSAppTransportSecurity": {"NSExceptionDomains": []}}, ats_policy(domains="invalid"))]
        for index, (plist, expected) in enumerate(cases):
            with self.subTest(case=index):
                observed = run.runner_ats_policy(plist)
                self.assertEqual(observed, expected)
                self.assertNotIn(secret, json.dumps(observed))

    def test_count_is_capped_without_inspecting_domains_or_invalid_objects(self):
        run = load("run_auth")
        class Uninspectable:
            def __str__(self): raise AssertionError("must not stringify")
            def __repr__(self): raise AssertionError("must not repr")
            def __bool__(self): raise AssertionError("must not derive truthiness")
            def __iter__(self): raise AssertionError("must not iterate")
        domains = {index: Uninspectable() for index in range(40)}
        self.assertEqual(run.runner_ats_policy({"NSAppTransportSecurity": {"NSExceptionDomains": domains}}), ats_policy(domains="dict", count=32))
        self.assertEqual(run.runner_ats_policy({"NSAppTransportSecurity": {"NSAllowsArbitraryLoads": Uninspectable(), "NSExceptionDomains": Uninspectable()}}),
                         ats_policy(arbitrary="invalid", domains="invalid"))
        self.assertEqual(run.runner_ats_policy(Uninspectable()), ats_policy(ats="unavailable", arbitrary="unavailable", domains="unavailable"))

    def test_observer_runs_after_first_latch_and_preserves_original_exception(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        original = AssertionError("PrivateATSSentinel123456")
        calls = []
        def observe():
            calls.append(diagnostic.observed)
            return ats_policy(arbitrary="bool", enabled=True)
        with self.assertRaises(AssertionError) as caught:
            with diagnostic.stage("runner-ats-check", observe_ats=observe):
                raise original
        self.assertIs(caught.exception, original)
        self.assertEqual(calls, [True])
        first = {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None,
                 "atsPolicy": ats_policy(arbitrary="bool", enabled=True)}
        self.assertEqual(diagnostic.first, first)
        with self.assertRaises(OSError):
            with diagnostic.stage("simulator-delete", observe_ats=observe):
                raise OSError("private cleanup")
        self.assertEqual(calls, [True])
        self.assertEqual(diagnostic.first, first)

    def test_no_collection_on_success_other_stage_or_wrong_category(self):
        run = load("run_auth")
        observer = MagicMock(side_effect=AssertionError("must not observe"))
        diagnostic = run.FailureDiagnostic()
        with diagnostic.stage("runner-ats-check", observe_ats=observer):
            pass
        self.assertIsNone(diagnostic.first)
        for stage, error in [("runner-test", AssertionError("private")),
                             ("runner-ats-check", run.PrivateCommandFailure("nonzero-exit", 65, "private"))]:
            with self.subTest(stage=stage):
                diagnostic = run.FailureDiagnostic()
                with self.assertRaises(type(error)) as caught:
                    with diagnostic.stage(stage, observe_ats=observer):
                        raise error
                self.assertIs(caught.exception, error)
                self.assertNotIn("atsPolicy", diagnostic.first)
        observer.assert_not_called()

    def test_broken_or_invalid_observer_preserves_base_and_original_error(self):
        run = load("run_auth")
        for observer in [MagicMock(side_effect=OSError("private")), MagicMock(return_value={"domains": "PrivateATSSentinel123456"})]:
            with self.subTest(observer=True):
                diagnostic = run.FailureDiagnostic()
                original = AssertionError("PrivateATSSentinel123456")
                with self.assertRaises(AssertionError) as caught:
                    with diagnostic.stage("runner-ats-check", observe_ats=observer):
                        raise original
                self.assertIs(caught.exception, original)
                self.assertEqual(diagnostic.first, {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None})
                observer.assert_called_once()


class RunnerBuildSignalTests(unittest.TestCase):
    destination = "xcodebuild: error: Unable to find a destination matching the provided destination specifier:\n"
    device_destination = "xcodebuild: error: Unable to find a device matching the provided destination specifier:\n"
    sdk = 'xcodebuild: error: SDK "PrivateSdkSentinel" cannot be located.\n'
    scheme = "xcodebuild: error: Scheme PrivateSchemeSentinel is not currently configured for the test action.\n"
    compiler = "/private/PrivatePathSentinel/AuthJourney.swift:12:3: error: PrivateCompilerSentinel\n"

    def observe(self, run, stdout, stderr, *, flag=True, status=70):
        diagnostic = run.FailureDiagnostic()
        response = subprocess.CompletedProcess(["private-fixture"], status, stdout, stderr)
        with patch.object(run.subprocess, "run", return_value=response) as process:
            try:
                with diagnostic.stage("runner-build"):
                    run.command("private-fixture", observe_build_signals=flag)
            except run.PrivateCommandFailure as error:
                self.assertEqual(error.exit_code, status)
                self.assertEqual(str(error), "Private verification command failed")
            self.assertEqual(process.call_count, 1)
        return diagnostic.first

    def test_exact_device_destination_wording_is_a_closed_signal(self):
        run = load("run_auth")
        diagnostic = self.observe(run, "", self.device_destination)
        self.assertEqual(diagnostic, {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                                      "errorSignals": ["destination-selection"], "signalScanLimited": False})
        for noise in [self.device_destination.replace("error:", "warning:"),
                      " " + self.device_destination, "print('" + self.device_destination.rstrip() + "')",
                      self.device_destination.replace("the provided destination specifier", "a different target"),
                      "xcodebuild: error: Unable to find a device matching\n"]:
            with self.subTest(noise=True):
                self.assertEqual(self.observe(run, "", noise)["errorSignals"], ["unclassified"])

    def test_each_signal_uses_only_a_closed_enum(self):
        run = load("run_auth")
        for marker, expected in [(self.destination, "destination-selection"), (self.sdk, "sdk-availability"),
                                 (self.scheme, "scheme-configuration"), (self.compiler, "compiler-error")]:
            with self.subTest(signal=expected):
                result = self.observe(run, "", marker)
                self.assertEqual(result, {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                                          "errorSignals": [expected], "signalScanLimited": False})
                self.assertNotIn("Private", json.dumps(result))

    def test_multiple_streams_are_deduplicated_and_sorted_without_causal_order(self):
        run = load("run_auth")
        result = self.observe(run, self.compiler + self.sdk + self.destination, self.scheme + self.destination)
        self.assertEqual(result["errorSignals"], ["destination-selection", "sdk-availability", "scheme-configuration", "compiler-error"])
        self.assertFalse(result["signalScanLimited"])

    def test_unknown_empty_and_non_error_text_remain_unclassified(self):
        run = load("run_auth")
        for text in ["", "private generic failure\n", "Command line invocation: " + self.destination,
                     'let text = "' + self.compiler.strip() + '"\n',
                     self.compiler.replace(": error:", ": warning:"),
                     "prefix " + self.sdk, " \t" + self.destination,
                     "private-nul\x00 private-emoji🙂\n"]:
            with self.subTest(text_index=len(text)):
                result = self.observe(run, text, "")
                self.assertEqual(result["errorSignals"], ["unclassified"])
                self.assertFalse(result["signalScanLimited"])

    def test_observer_is_opt_in_and_does_not_change_generic_commands(self):
        run = load("run_auth")
        with patch.object(run, "runner_build_error_signals", side_effect=AssertionError("observer must not run")):
            for flag in [False, None, 1, "true"]:
                with self.subTest(flag=type(flag).__name__):
                    self.assertEqual(self.observe(run, "", self.destination, flag=flag),
                                     {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70})

    def test_success_does_not_observe_even_when_the_flag_is_enabled(self):
        run = load("run_auth")
        with patch.object(run, "runner_build_error_signals", side_effect=AssertionError("observer must not run")):
            self.assertIsNone(self.observe(run, self.destination, "", status=0))

    def test_scan_first_and_last_windows_only_and_reports_omitted_middle(self):
        run = load("run_auth")
        text = self.destination + ("ordinary line\n" * 12000) + self.compiler
        result = self.observe(run, text, self.sdk)
        self.assertEqual(result["errorSignals"], ["destination-selection", "sdk-availability", "compiler-error"])
        self.assertTrue(result["signalScanLimited"])
        hidden = ("ordinary line\n" * 7000) + self.scheme + ("ordinary line\n" * 7000)
        result = self.observe(run, hidden, "")
        self.assertEqual(result["errorSignals"], ["unclassified"])
        self.assertTrue(result["signalScanLimited"])

    def test_line_length_boundary_and_clipped_fragments_cannot_create_signals(self):
        run = load("run_auth")
        prefix = "xcodebuild: error: Unable to find a destination matching "
        for length, expected in [(8192, "destination-selection"), (8193, "unclassified")]:
            with self.subTest(length=length):
                result = self.observe(run, prefix + "x" * (length - len(prefix)) + "\n", "")
                self.assertEqual(result["errorSignals"], [expected])
                self.assertEqual(result["signalScanLimited"], length > 8192)
        # The tail starts at a marker within a huge line, not at a real error line.
        tail = self.destination + "x" * (65536 - len(self.destination))
        result = self.observe(run, "x" * 100000 + tail, "")
        self.assertEqual(result["errorSignals"], ["unclassified"])
        self.assertTrue(result["signalScanLimited"])

    def test_collector_failure_omits_only_the_supplement_and_keeps_first_failure(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        response = subprocess.CompletedProcess(["fixture"], 70, "private", self.destination)
        original = []
        with patch.object(run.subprocess, "run", return_value=response), \
                patch.object(run, "runner_build_error_signals", side_effect=OSError("private observer failure")):
            with self.assertRaises(run.PrivateCommandFailure) as observed:
                with diagnostic.stage("runner-build"):
                    try:
                        run.command("fixture", observe_build_signals=True)
                    except run.PrivateCommandFailure as error:
                        original.append(error)
                        raise
        self.assertIs(observed.exception, original[0])
        self.assertEqual(diagnostic.first, {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70})
        with self.assertRaises(RuntimeError):
            with diagnostic.stage("simulator-delete"):
                raise RuntimeError("private cleanup failure")
        self.assertEqual(diagnostic.first["stage"], "runner-build")

    def test_malformed_collector_payload_cannot_replace_the_base_diagnostic(self):
        run = load("run_auth")
        for payload in [None, [], {"errorSignals": ["private"], "signalScanLimited": False},
                        {"errorSignals": ["compiler-error"], "signalScanLimited": False, "exitCode": 11}]:
            with self.subTest(payload_type=type(payload).__name__), \
                    patch.object(run, "runner_build_error_signals", return_value=payload):
                self.assertEqual(self.observe(run, "", self.compiler),
                                 {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70})

    def test_real_nonzero_process_keeps_capture_argv_exit_and_execution_count(self):
        run = load("run_auth")
        diagnostic = run.FailureDiagnostic()
        code = "import sys; print('private stdout'); sys.stderr.write(sys.argv[1]); sys.exit(70)"
        with tempfile.TemporaryDirectory() as temporary:
            log = Path(temporary) / "private.log"
            actual = run.subprocess.run
            with patch.object(run.subprocess, "run", wraps=actual) as process, self.assertRaises(run.PrivateCommandFailure):
                with diagnostic.stage("runner-build"):
                    run.command(sys.executable, "-c", code, self.destination, timeout=5,
                                private_log=log, observe_build_signals=True)
            self.assertEqual(process.call_count, 1)
            self.assertEqual(process.call_args.args[0], (sys.executable, "-c", code, self.destination))
            self.assertEqual(process.call_args.kwargs, {"capture_output": True, "text": True, "timeout": 5})
            self.assertEqual(log.read_text(), "private stdout\n" + self.destination)
        self.assertEqual(diagnostic.first, {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                                          "errorSignals": ["destination-selection"], "signalScanLimited": False})

    def test_real_success_timeout_and_missing_executable_do_not_collect(self):
        run = load("run_auth")
        with tempfile.TemporaryDirectory() as temporary, \
                patch.object(run, "runner_build_error_signals", side_effect=AssertionError("observer must not run")):
            self.assertEqual(run.command(sys.executable, "-c", "print(' kept ')", timeout=5,
                                         observe_build_signals=True), "kept")
            for arguments, timeout, category in [
                    ((sys.executable, "-c", "import time; time.sleep(60)"), 0.15, "timed-out"),
                    ((str(Path(temporary) / "missing-executable"),), 5, "unavailable")]:
                with self.subTest(category=category):
                    diagnostic = run.FailureDiagnostic()
                    with self.assertRaises(run.PrivateCommandFailure):
                        with diagnostic.stage("runner-build"):
                            run.command(*arguments, timeout=timeout, observe_build_signals=True)
                    self.assertEqual(diagnostic.first, {"stage": "runner-build", "category": category, "exitCode": None})

    def test_a_supplement_cannot_escape_its_runner_build_stage(self):
        run = load("run_auth")
        for stage in ["runner-test", "simulator-delete"]:
            with self.subTest(stage=stage):
                diagnostic = run.FailureDiagnostic()
                error = run.PrivateCommandFailure("nonzero-exit", 70, "Private verification command failed")
                error.build_signals = {"errorSignals": ["compiler-error"], "signalScanLimited": False}
                with self.assertRaises(run.PrivateCommandFailure) as observed:
                    with diagnostic.stage(stage):
                        raise error
                self.assertIs(observed.exception, error)
                self.assertEqual(diagnostic.first, {"stage": stage, "category": "nonzero-exit", "exitCode": 70})


class FailureDiagnosticExportTests(unittest.TestCase):
    def result(self, run, diagnostic):
        return {"passed": False, "scope": run.SCOPE, "commit": "b" * 40,
                "runtime": "com.apple.CoreSimulator.SimRuntime.iOS-18-5", "sdkVersion": "18.5", "steps": [],
                "failureKind": "native-journey-failed", "failureDiagnostic": diagnostic}

    def export(self, run, private, public, result):
        builds = [{"app": app, "bundleId": bundle, "mode": "Release", "sha256": "a" * 64}
                  for app, bundle in run.APPS.items()]
        (private / "builds.json").write_text(json.dumps(builds))
        (private / "result.json").write_text(json.dumps(result))
        run.export_evidence(private, public, ["PrivateExportSentinel123456"])

    def test_valid_failed_result_preserves_optional_closed_diagnostic(self):
        run = load("run_auth")
        diagnostic = {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 65}
        with tempfile.TemporaryDirectory() as temporary:
            private, public = Path(temporary) / "private", Path(temporary) / "public"
            private.mkdir()
            self.export(run, private, public, self.result(run, diagnostic))
            self.assertEqual(json.loads((public / "result.json").read_text())["failureDiagnostic"], diagnostic)
            self.assertEqual({item.name for item in public.iterdir()}, {"builds.json", "result.json"})

    def test_export_rejects_unknown_keys_types_categories_and_exit_code_bounds(self):
        run = load("run_auth")
        valid = {"stage": "runner-test", "category": "nonzero-exit", "exitCode": 65}
        invalid = [None, [], "PrivateExportSentinel123456", {}, {**valid, "assertion": "private"},
                   {**valid, "argv": ["private"]}, {**valid, "stage": "private"}, {**valid, "stage": []},
                   {**valid, "category": "private"}, {**valid, "category": {}},
                   *[{**valid, "exitCode": code} for code in [True, False, 0, 256, -256, 1.0, "65", []]],
                   *[{**valid, "category": category} for category in ["timed-out", "unavailable", "verification-failed"]]]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, diagnostic in enumerate(invalid):
                with self.subTest(index=index):
                    private, public = root / str(index), root / (str(index) + "-public")
                    private.mkdir()
                    with self.assertRaises(run.SecurityViolation):
                        self.export(run, private, public, self.result(run, diagnostic))
                    self.assertFalse(public.exists())

    def test_diagnostic_never_turns_a_success_or_primary_rejection_into_approval(self):
        run = load("run_auth")
        diagnostic = {"stage": "runner-test", "category": "nonzero-exit", "exitCode": 65}
        original = self.result(run, diagnostic)
        success = {**original, "passed": True,
                   "steps": [{"app": app, "phase": phase, "passed": True} for app, phase in run.expected_order()]}
        del success["failureKind"]
        for invalid in [success, {**original, "failureKind": "phase-rejected"},
                        {**original, "failureKind": "security-rejection"},
                        {**original, "securityFailure": {"kind": "private-identity", "observedAt": "2026-10-04T22:00:00Z"}}]:
            with self.assertRaises(run.SecurityViolation):
                run.safe_json("result.json", invalid)

    def test_optional_build_signals_are_exported_only_as_a_closed_pair(self):
        run = load("run_auth")
        for signals, limited in [(["destination-selection"], False), (["unclassified"], True),
                                 (["destination-selection", "sdk-availability", "scheme-configuration", "compiler-error"], False)]:
            with self.subTest(signals=signals), tempfile.TemporaryDirectory() as temporary:
                diagnostic = {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                              "errorSignals": signals, "signalScanLimited": limited}
                private, public = Path(temporary) / "private", Path(temporary) / "public"
                private.mkdir()
                self.export(run, private, public, self.result(run, diagnostic))
                self.assertEqual(json.loads((public / "result.json").read_text())["failureDiagnostic"], diagnostic)

    def test_build_signal_schema_rejects_types_enums_caps_order_and_other_stages(self):
        run = load("run_auth")
        valid = {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                 "errorSignals": ["destination-selection"], "signalScanLimited": False}
        invalid = [{key: value for key, value in valid.items() if key != omitted}
                   for omitted in ["errorSignals", "signalScanLimited"]]
        invalid += [{**valid, "errorSignals": signals} for signals in [
            None, "destination-selection", {}, (), [], [None], [True], [1], [[]],
            ["PrivateExportSentinel123456"], ["destination-selection"] * 2,
            ["compiler-error", "destination-selection"], ["unclassified", "compiler-error"],
            ["destination-selection", "sdk-availability", "scheme-configuration", "compiler-error", "unclassified"]]]
        invalid += [{**valid, "signalScanLimited": value} for value in [None, 0, 1, 0.0, "false", [], {}]]
        invalid += [{**valid, "stage": stage} for stage in run.DIAGNOSTIC_STAGES if stage != "runner-build"]
        invalid += [{**valid, "category": category, "exitCode": None}
                    for category in run.DIAGNOSTIC_CATEGORIES if category != "nonzero-exit"]
        invalid += [{**valid, "rawLine": "PrivateExportSentinel123456"}]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, diagnostic in enumerate(invalid):
                with self.subTest(index=index):
                    private, public = root / str(index), root / (str(index) + "-public")
                    private.mkdir()
                    with self.assertRaises(run.SecurityViolation):
                        self.export(run, private, public, self.result(run, diagnostic))
                    self.assertFalse(public.exists())

    def test_build_signals_cannot_be_published_on_success_or_primary_rejection(self):
        run = load("run_auth")
        diagnostic = {"stage": "runner-build", "category": "nonzero-exit", "exitCode": 70,
                      "errorSignals": ["compiler-error"], "signalScanLimited": False}
        original = self.result(run, diagnostic)
        success = {**original, "passed": True,
                   "steps": [{"app": app, "phase": phase, "passed": True} for app, phase in run.expected_order()]}
        del success["failureKind"]
        invalid = [success, {**original, "failureKind": "phase-rejected"},
                   {**original, "failureKind": "security-rejection"},
                   {**original, "securityFailure": {"kind": "private-identity", "observedAt": "2026-10-04T22:00:00Z"}}]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, result in enumerate(invalid):
                with self.subTest(index=index):
                    private, public = root / str(index), root / (str(index) + "-public")
                    private.mkdir()
                    with self.assertRaises(run.SecurityViolation):
                        self.export(run, private, public, result)
                    self.assertFalse(public.exists())

    def test_closed_ats_policy_is_exported_only_in_its_failed_guard(self):
        run = load("run_auth")
        for policy in [ats_policy(arbitrary="bool", enabled=True), ats_policy(domains="dict", count=32),
                       ats_policy(ats="invalid", arbitrary="unavailable", domains="unavailable")]:
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as temporary:
                diagnostic = {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None, "atsPolicy": policy}
                private, public = Path(temporary) / "private", Path(temporary) / "public"
                private.mkdir()
                self.export(run, private, public, self.result(run, diagnostic))
                self.assertEqual(json.loads((public / "result.json").read_text())["failureDiagnostic"], diagnostic)

    def test_ats_policy_schema_rejects_names_types_caps_incoherence_and_other_stages(self):
        run = load("run_auth")
        policy = ats_policy(arbitrary="bool", enabled=True, domains="dict", count=1)
        valid = {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None, "atsPolicy": policy}
        policies = [None, [], "PrivateExportSentinel123456", {},
                    {**policy, "domains": {"PrivateExportSentinel123456": {}}},
                    *[{key: value for key, value in policy.items() if key != omitted} for omitted in policy]]
        for key in ["atsKind", "arbitraryLoadsKind", "exceptionDomainsKind"]:
            policies += [{**policy, key: value} for value in [None, True, 1, [], {}, "PrivateExportSentinel123456"]]
        policies += [{**policy, "arbitraryLoadsEnabled": value} for value in [None, 0, 1, 0.0, "true", [], {}]]
        policies += [{**policy, "exceptionDomainCountCapped": value} for value in [None, True, False, -1, 33, 1.0, "1", [], {}]]
        policies += [{**policy, "arbitraryLoadsKind": kind} for kind in ["absent", "dict", "invalid", "unavailable"]]
        policies += [{**policy, "exceptionDomainsKind": kind} for kind in ["absent", "bool", "invalid", "unavailable"]]
        policies += [{**policy, "atsKind": kind} for kind in ["absent", "bool", "invalid", "unavailable"]]
        policies += [ats_policy(arbitrary="unavailable"), ats_policy(domains="unavailable"),
                     ats_policy(ats="absent", arbitrary="absent", domains="unavailable"),
                     ats_policy(ats="unavailable", arbitrary="unavailable", domains="dict", count=0)]
        invalid = [{**valid, "atsPolicy": value} for value in policies]
        invalid += [{**valid, "stage": stage} for stage in run.DIAGNOSTIC_STAGES if stage != "runner-ats-check"]
        invalid += [{**valid, "category": category} for category in run.DIAGNOSTIC_CATEGORIES if category != "verification-failed"]
        invalid += [{**valid, "exitCode": 65}, {**valid, "errorSignals": ["unclassified"], "signalScanLimited": False}]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, diagnostic in enumerate(invalid):
                with self.subTest(case=index):
                    private, public = root / str(index), root / (str(index) + "-public")
                    private.mkdir()
                    with self.assertRaises(run.SecurityViolation):
                        self.export(run, private, public, self.result(run, diagnostic))
                    self.assertFalse(public.exists())

    def test_ats_policy_cannot_override_success_or_primary_rejection(self):
        run = load("run_auth")
        diagnostic = {"stage": "runner-ats-check", "category": "verification-failed", "exitCode": None,
                      "atsPolicy": ats_policy(arbitrary="bool", enabled=True)}
        original = self.result(run, diagnostic)
        success = {**original, "passed": True,
                   "steps": [{"app": app, "phase": phase, "passed": True} for app, phase in run.expected_order()]}
        del success["failureKind"]
        cases = [success, {**original, "failureKind": "phase-rejected"}, {**original, "failureKind": "security-rejection"},
                 {**original, "securityFailure": {"kind": "private-identity", "observedAt": "2026-10-05T00:00:00Z"}}]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index, result in enumerate(cases):
                with self.subTest(case=index):
                    private, public = root / str(index), root / (str(index) + "-public")
                    private.mkdir()
                    with self.assertRaises(run.SecurityViolation):
                        self.export(run, private, public, result)
                    self.assertFalse(public.exists())


class SourceContractTests(unittest.TestCase):
    def test_database_evidence_accepts_only_the_verified_maintenance_sources(self):
        run = load("run_auth")
        pinned = {"postgres": "16.15", "timescale": "2.17.2",
                  "postgresSha256": "c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed",
                  "timescaleSha256": "85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb"}
        run.safe_json("database-source.json", pinned)
        for invalid in [
            {**pinned, "postgres": "16.4"},
            {**pinned, "postgresSha256": "971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f"},
            {**pinned, "postgresSha256": "a" * 64},
            {**pinned, "timescale": "2.17.3"},
            {**pinned, "privateLog": "SENTINEL_SECRET"},
        ]:
            with self.subTest(fields=list(invalid)), self.assertRaises(run.SecurityViolation):
                run.safe_json("database-source.json", invalid)

    def test_database_is_pinned_and_scoped(self):
        source = (BASE / "database.sh").read_text()
        for literal in ["c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed", "85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb", "contrib/btree_gist", "127.0.0.1", "RUNNER_TEMP"]:
            self.assertIn(literal, source)
        self.assertNotIn("sudo", source)

    def test_standalone_runner_and_no_raw_artifact_upload(self):
        ruby = (BASE / "project.rb").read_text()
        self.assertIn(":ui_test_bundle", ruby)
        self.assertIn("USES_XCTRUNNER", ruby)
        self.assertNotIn("TEST_TARGET_NAME", ruby)
        self.assertNotIn("TEST_HOST", ruby)
        workflow = (BASE.parents[1] / ".github/workflows/ios-auth.yml").read_text()
        self.assertIn("runs-on: macos-15", workflow)
        self.assertIn("path: .local/ios-auth/evidence/", workflow)
        self.assertNotIn("path: ${{ runner.temp }}", workflow)
        swift = (BASE / "AuthJourney.swift").read_text()
        self.assertIn("XCUIApplication(bundleIdentifier:", swift)
        self.assertNotIn("XCTAttachment", swift)


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.run = load("run_auth")
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.coordinator = self.run.Coordinator(self.root, self.root, self.root / "fixture.json",
            "f19ce90e-9c36-461d-a499-692ff2570a01", "private-coordinator-token", ["SecretPassword123456"])

    def tearDown(self):
        self.temporary.cleanup()

    def test_first_security_negative_blocks_all_future_reads_and_captures(self):
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/rejection", {"kind": "private-identity"})
        with patch.object(self.run, "database_snapshot") as database, patch.object(self.run, "command") as capture:
            for app in self.run.APPS:
                with self.assertRaises(self.run.SecurityViolation):
                    self.coordinator.request("/checkpoint", {"app": app, "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}})
            database.assert_not_called()
            capture.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_database_mismatch_or_bad_sequence_never_capture(self):
        self.coordinator.started = True
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("login") for app in self.run.APPS}), patch.object(self.run, "command") as capture:
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", valid)
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", {**valid, "phase": "01-login"})
            capture.assert_not_called()
        self.assertEqual(list(self.root.iterdir()), [])

    def test_png_is_captured_only_after_native_and_database_approval(self):
        self.coordinator.started = True
        snapshot = {app: self.run.counts("empty") for app in self.run.APPS}
        order = []
        def db(_fixture):
            order.append("database"); return snapshot
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "database_snapshot", side_effect=db), patch.object(self.run, "command") as capture:
            response = self.coordinator.request("/checkpoint", valid)
            capture.assert_not_called()
            self.assertEqual(list(self.root.iterdir()), [])
            self.assertEqual(self.coordinator.steps, [])
            import base64
            self.coordinator.request("/capture", {**valid, "nonce": response["nonce"],
                "png": base64.b64encode(png_fixture()).decode()})
            capture.assert_not_called()
        self.assertEqual(order, ["database"])
        self.assertEqual(len(self.coordinator.steps), 1)
        exported = json.loads((self.root / "resident-mobile-00-empty.json").read_text())
        self.assertEqual(set(exported), {"app", "phase", "checks", "snapshot", "apiEvents", "screenshotSha256"})
        self.assertNotIn("tree", exported)

    def test_nonce_expired_wrong_or_replayed_never_exports_an_image(self):
        import base64
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.coordinator.started = True
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("empty") for app in self.run.APPS}):
            response = self.coordinator.request("/checkpoint", valid)
        image = base64.b64encode(png_fixture()).decode()
        for change in [{"nonce": "wrong"}, {"app": "operations-mobile"}, {"checks": {"privacy": False, "screen": True, "secure": True}}]:
            with self.assertRaises(self.run.SecurityViolation):
                self.coordinator.request("/capture", {**valid, "nonce": response["nonce"], "png": image, **change})
            self.assertEqual(list(self.root.iterdir()), [])
        self.coordinator.pending["expires"] = 0
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/capture", {**valid, "nonce": response["nonce"], "png": image})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_real_response_can_finish_after_ui_but_retries_or_wrong_status_fail(self):
        response = {"method": "POST", "path": "/auth/logout", "status": 204}
        with patch.object(self.run, "proxy_events", side_effect=[[], [response]]), patch.object(self.run.time, "sleep") as wait:
            self.assertEqual(self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204)), [response])
            wait.assert_called_once_with(0.25)
        for events in [[response, response], [{**response, "status": 500}]]:
            with patch.object(self.run, "proxy_events", return_value=events), self.assertRaises(AssertionError):
                self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204))

    def test_missing_real_response_has_a_bounded_deadline(self):
        with patch.object(self.run, "proxy_events", return_value=[]), patch.object(self.run.time, "monotonic", side_effect=[0, 16]), patch.object(self.run.time, "sleep") as wait:
            with self.assertRaises(AssertionError):
                self.run.wait_proxy_events(self.root / "proxy.log", 0, ("/auth/logout", 204))
            wait.assert_not_called()

    def test_late_duplicate_logout_is_rejected_on_cold_phase_before_capture(self):
        product = "operations-mobile"
        phase = "12-cold-logout-empty"
        self.coordinator.started = True
        self.coordinator.states = {app: "logout" for app in self.run.APPS}
        self.coordinator.steps = [{"app": app, "phase": name, "passed": True}
                                  for app, name in self.coordinator.order[:-1]]
        event = {"method": "POST", "path": "/auth/logout", "status": 204}
        snapshot = {app: self.run.counts("logout") for app in self.run.APPS}
        payload = {"app": product, "phase": phase, "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", return_value=[event]), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_required_phase_rejects_an_extra_post_to_another_auth_route(self):
        self.coordinator.started = True
        self.coordinator.steps = [{"app": "resident-mobile", "phase": "00-empty", "passed": True}]
        events = [{"method": "POST", "path": "/auth/login", "status": 200},
                  {"method": "POST", "path": "/auth/logout", "status": 204}]
        snapshot = {app: self.run.counts("login" if app == "resident-mobile" else "empty") for app in self.run.APPS}
        payload = {"app": "resident-mobile", "phase": "01-login", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", return_value=events), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)

    def test_post_arriving_during_database_snapshot_is_rejected_before_nonce(self):
        self.coordinator.started = True
        snapshot = {app: self.run.counts("empty") for app in self.run.APPS}
        event = {"method": "POST", "path": "/auth/logout", "status": 204}
        payload = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        with patch.object(self.run, "proxy_events", side_effect=[[], [event]]), patch.object(self.run, "database_snapshot", return_value=snapshot):
            with self.assertRaises(AssertionError):
                self.coordinator.request("/checkpoint", payload)
        self.assertIsNone(self.coordinator.pending)

    def test_finish_rejects_late_extra_post_without_replaying_any_action(self):
        self.coordinator.started = True
        self.coordinator.steps = [{"app": app, "phase": phase, "passed": True} for app, phase in self.coordinator.order]
        expected = [{"method": "POST", "path": path, "status": status} for path, status in [
            ("/auth/login", 200), ("/auth/login", 200),
            ("/auth/password", 400), ("/auth/refresh", 200), ("/auth/password", 204),
            ("/auth/login", 401), ("/auth/login", 200), ("/auth/logout", 204),
            ("/auth/password", 400), ("/auth/refresh", 200), ("/auth/password", 204),
            ("/auth/login", 401), ("/auth/login", 200), ("/auth/logout", 204),
        ]]
        self.assertEqual(len(expected), 14)
        with patch.object(self.run, "proxy_events", return_value=expected + [expected[-1]]), patch.object(self.run, "command") as command:
            with self.assertRaises(AssertionError):
                self.coordinator.request("/finish", {})
            command.assert_not_called()
        self.assertFalse(self.coordinator.finished)
        with patch.object(self.run, "proxy_events", return_value=expected), patch.object(self.run, "command") as command:
            self.coordinator.request("/finish", {})
            command.assert_not_called()
        self.assertTrue(self.coordinator.finished)

    def test_changed_tree_after_db_approval_blocks_the_pending_capture(self):
        valid = {"app": "resident-mobile", "phase": "00-empty", "checks": {"privacy": True, "screen": True, "secure": True}}
        self.coordinator.started = True
        with patch.object(self.run, "database_snapshot", return_value={app: self.run.counts("empty") for app in self.run.APPS}):
            self.coordinator.request("/checkpoint", valid)
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/rejection", {"kind": "private-identity"})
        with self.assertRaises(self.run.SecurityViolation):
            self.coordinator.request("/capture", {**valid, "nonce": "anything", "png": "anything"})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_proxy_diagnostics_have_an_exact_route_and_scalar_schema(self):
        log = self.root / "proxy.log"
        for item in [{"method": "POST", "path": "/access/gate/open", "status": 200},
                     {"method": "POST", "path": "/auth/login", "status": 200, "body": "password"},
                     {"method": "POST", "path": "/auth/login", "status": True}]:
            log.write_text(json.dumps(item))
            with self.assertRaises(self.run.SecurityViolation):
                self.run.proxy_events(log)

    def test_driver_errors_never_export_stdout_stderr_or_arguments(self):
        secret = "NoSecretMayReachAnException123"
        response = type("Response", (), {"returncode": 1, "stdout": secret, "stderr": secret})()
        with patch.object(self.run.subprocess, "run", return_value=response):
            with self.assertRaises(RuntimeError) as failure:
                self.run.command("xcodebuild", secret)
        self.assertNotIn(secret, str(failure.exception))

    def test_non_ci_guard_precedes_products_and_commands(self):
        with patch.dict(self.run.os.environ, {"GITHUB_ACTIONS": "false"}), patch.object(self.run, "command") as command:
            with self.assertRaises(ValueError):
                self.run.run(self.root, self.root / "evidence", self.root / "personal.app", self.root / "peer.app")
            command.assert_not_called()


if __name__ == "__main__":
    unittest.main()
