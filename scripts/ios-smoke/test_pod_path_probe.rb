# Host-only diagnostics tests. No CocoaPods installation, Apple SDK or app journey.
require 'minitest/autorun'
require 'open3'
require 'rbconfig'
require 'json'
require 'tmpdir'

class PodPathProbeTest < Minitest::Test
  SOURCE = File.expand_path('pod_path_probe.rb', __dir__)
  PREAMBLE = <<~RUBY
    require 'json'
    require 'stringio'
    require 'pathname'
    require 'tmpdir'
    require 'fileutils'
    require #{SOURCE.inspect}
    output = StringIO.new
    probe = PredioOnPodPathProbe
    def decoded(output)
      output.string.lines.map { |line| JSON.parse(line.delete_prefix(PredioOnPodPathProbe::PREFIX)) }
    end
    def installed_stub(folder, cli)
      stub = File.join(folder, 'bin', 'pod')
      FileUtils.mkdir_p(File.dirname(stub))
      File.write(stub, "require 'rubygems'; load Gem.bin_path('cocoapods', 'pod')\n")
      Gem.loaded_specs['cocoapods'] = Struct.new(:base_dir, :version).new(folder, Gem::Version.new('1.15.2'))
      Gem.define_singleton_method(:bindir) { |base| File.join(base, 'bin') }
      Gem.define_singleton_method(:bin_path) do |gem, executable|
        raise 'Wrong official executable' unless [gem, executable] == ['cocoapods', 'pod']
        cli
      end
      stub
    end
  RUBY

  def child(code)
    stdout, stderr, status = Open3.capture3(RbConfig.ruby, '-', stdin_data: PREAMBLE + code)
    assert status.success?, "Host child failed: #{stderr}"
    JSON.parse(stdout)
  end

  def test_returned_nul_from_file_reaches_pathname_and_remains_terminal
    result = child(<<~RUBY)
      input = '/controlled-valid-input'
      returned = "invalid\0result"
      seen = []
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) { |*args| seen << args; returned }
      end)
      probe.install(output: output)
      original = nil
      begin
        Pathname.new(input).realdirpath
      rescue ArgumentError => error
        original = error
      end
      probe.finish(original)
      lines = decoded(output)
      failure = lines.find { |line| line['stage'] == 'first_nul_failure' }
      puts JSON.generate({ terminal: original&.message == 'pathname contains null byte', calls: seen.length,
                           sameInput: seen.first == [input, nil], failure: failure, lines: lines.length })
    RUBY
    assert_equal true, result.fetch('terminal')
    assert_equal 1, result.fetch('calls')
    assert_equal true, result.fetch('sameInput')
    failure = result.fetch('failure')
    refute_nil failure
    assert_equal 'returned_nul', failure.fetch('category')
    assert_equal false, failure.fetch('inputNul')
    assert_equal true, failure.fetch('returnedNul')
    assert_equal true, failure.fetch('viaPathname')
    assert_equal 3, result.fetch('lines')
  end

  def test_original_return_object_arguments_and_gc_flags_are_preserved
    result = child(<<~RUBY)
      input, base, returned = '/controlled-input', '/controlled-base', 'controlled-return'
      seen = []
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) { |*args| seen << args; returned }
      end)
      before = [GC.stress, GC.auto_compact]
      probe.install(output: output)
      actual = File.realdirpath(input, base)
      probe.finish
      puts JSON.generate({ sameObject: actual.equal?(returned), calls: seen.length,
                           sameArgs: seen.first == [input, base], sameGc: before == [GC.stress, GC.auto_compact],
                           stages: decoded(output).map { |line| line['stage'] } })
    RUBY
    assert_equal true, result.fetch('sameObject')
    assert_equal 1, result.fetch('calls')
    assert_equal true, result.fetch('sameArgs')
    assert_equal true, result.fetch('sameGc')
    assert_equal %w[start finish], result.fetch('stages')
  end

  def test_original_exception_object_and_single_call_are_preserved
    result = child(<<~RUBY)
      original = ArgumentError.new('PRIVATE_SENTINEL_DO_NOT_LOG')
      calls = 0
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) { |*args| calls += 1; raise original }
      end)
      probe.install(output: output)
      caught = nil
      begin; File.realdirpath('/bounded-valid'); rescue Exception => error; caught = error; end
      probe.finish(caught)
      puts JSON.generate({ sameException: caught.equal?(original), calls: calls,
                           leaked: output.string.include?('PRIVATE_SENTINEL'), lines: decoded(output) })
    RUBY
    assert_equal true, result.fetch('sameException')
    assert_equal 1, result.fetch('calls')
    assert_equal false, result.fetch('leaked')
    assert_equal %w[start finish], result.fetch('lines').map { |line| line.fetch('stage') }
    assert_equal 1, result.fetch('lines').last.fetch('otherPathExceptions')
  end

  def test_unknown_path_object_is_converted_only_by_original_file
    result = child(<<~RUBY)
      conversions = 0
      object = Object.new
      object.define_singleton_method(:to_path) { conversions += 1; "controlled\0converted" }
      File.singleton_class.prepend(Module.new do
        def exist?(*); raise 'Filesystem observer must skip'; end
        def directory?(*); raise 'Filesystem observer must skip'; end
        def file?(*); raise 'Filesystem observer must skip'; end
      end)
      probe.install(output: output)
      begin; File.realdirpath(object); rescue ArgumentError; end
      probe.finish
      failure = decoded(output)[1]
      puts JSON.generate({ conversions: conversions, inputClass: failure['inputClass'], fs: failure['filesystem'] })
    RUBY
    assert_equal 1, result.fetch('conversions')
    assert_equal 'other', result.fetch('inputClass')
    assert_equal 'skipped', result.fetch('fs').fetch('state')
  end

  def test_nul_input_is_terminal_and_never_probed_on_filesystem
    result = child(<<~RUBY)
      calls = 0
      File.singleton_class.prepend(Module.new do
        def exist?(*); raise 'No filesystem observation'; end
        def directory?(*); raise 'No filesystem observation'; end
        def file?(*); raise 'No filesystem observation'; end
        define_method(:realdirpath) { |*args| calls += 1; super(*args) }
      end)
      probe.install(output: output)
      caught = nil
      begin; File.realdirpath("input\0nul"); rescue ArgumentError => error; caught = error; end
      probe.finish(caught)
      puts JSON.generate({ terminal: caught&.message == 'path name contains null byte', calls: calls,
                           failure: decoded(output)[1] })
    RUBY
    assert_equal true, result.fetch('terminal')
    assert_equal 1, result.fetch('calls')
    assert_equal true, result.fetch('failure').fetch('inputNul')
    assert_equal 'skipped', result.fetch('failure').fetch('filesystem').fetch('state')
  end

  def test_long_input_is_not_scanned_or_probed
    result = child(<<~RUBY)
      original = ArgumentError.new('path name contains null byte')
      input = 'x' * 8193
      input.define_singleton_method(:include?) { |*| raise 'Must not scan long input' }
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) { |*| raise original }
        def exist?(*); raise 'Must not probe'; end
      end)
      probe.install(output: output)
      caught = nil
      begin; File.realdirpath(input); rescue Exception => error; caught = error; end
      probe.finish(caught)
      puts JSON.generate({ sameError: caught.equal?(original), failure: decoded(output)[1] })
    RUBY
    assert_equal true, result.fetch('sameError')
    assert_equal 'over-8192', result.fetch('failure').fetch('inputBytes')
    assert_nil result.fetch('failure').fetch('inputNul')
    assert_equal 'skipped', result.fetch('failure').fetch('filesystem').fetch('state')
  end

  def test_filesystem_metadata_is_collected_only_for_first_bounded_failure
    result = child(<<~RUBY)
      checks = []
      calls = 0
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) { |*| calls += 1; raise ArgumentError, 'path name contains null byte' }
        define_method(:exist?) { |path| checks << 'exists'; true }
        define_method(:directory?) { |path| checks << 'directory'; false }
        define_method(:file?) { |path| checks << 'file'; true }
      end)
      probe.install(output: output)
      4.times { begin; File.realdirpath('/private-not-logged'); rescue ArgumentError; end }
      probe.finish
      probe.finish
      puts JSON.generate({ calls: calls, checks: checks, lines: decoded(output), leaked: output.string.include?('/private-not-logged'),
                           sizes: output.string.lines.map(&:bytesize) })
    RUBY
    assert_equal 4, result.fetch('calls')
    assert_equal %w[exists directory file], result.fetch('checks')
    assert_equal 3, result.fetch('lines').length
    assert_equal false, result.fetch('leaked')
    assert result.fetch('sizes').all? { |size| size <= 2048 }
    assert_equal({ 'state' => 'observed', 'exists' => true, 'directory' => false, 'file' => true }, result.fetch('lines')[1].fetch('filesystem'))
  end

  def test_output_and_collector_failure_cannot_change_success_or_exception
    %w[output collector].each do |mode|
      result = child(<<~RUBY)
        returned = 'same-return'
        original = ArgumentError.new('path name contains null byte')
        fail_call = false
        File.singleton_class.prepend(Module.new do
          define_method(:realdirpath) { |*| fail_call ? (raise original) : returned }
        end)
        if #{mode.inspect} == 'output'
          output.define_singleton_method(:write) { |*| raise IOError, 'PRIVATE_OUTPUT' }
        else
          probe.define_singleton_method(:gc_snapshot) { raise 'PRIVATE_COLLECTOR' }
        end
        probe.install(output: output)
        actual = File.realdirpath('/valid')
        fail_call = true
        caught = nil
        begin; File.realdirpath('/valid'); rescue Exception => error; caught = error; end
        probe.finish(caught)
        puts JSON.generate({ sameObject: actual.equal?(returned), sameError: caught.equal?(original) })
      RUBY
      assert_equal true, result.fetch('sameObject'), mode
      assert_equal true, result.fetch('sameError'), mode
    end
  end

  def test_actual_relative_symlink_file_and_directory_resolution
    result = child(<<~RUBY)
      Dir.mktmpdir('controlled-pod-probe-') do |folder|
        real = File.join(folder, 'packages', 'long-relative-react-native', 'ReactCommon', 'utils')
        FileUtils.mkdir_p(real)
        File.write(File.join(real, 'OnScopeExit.h'), '// fixture')
        File.symlink('packages/long-relative-react-native', File.join(folder, 'link'))
        paths = [File.join(folder, 'link/ReactCommon/utils'), File.join(folder, 'link/ReactCommon/utils/OnScopeExit.h')]
        expected = paths.map { |path| File.realdirpath(path) }
        before = [GC.stress, GC.auto_compact]
        probe.install(output: output)
        observed = paths.map { |path| Pathname.new(path).realdirpath.to_s }
        probe.finish
        puts JSON.generate({ same: observed == expected, sameGc: before == [GC.stress, GC.auto_compact],
                             stages: decoded(output).map { |line| line['stage'] } })
      end
    RUBY
    assert_equal true, result.fetch('same')
    assert_equal true, result.fetch('sameGc')
    assert_equal %w[start finish], result.fetch('stages')
  end

  def test_launcher_preserves_arguments_program_name_single_execution_and_exit
    [0, 23].each do |exit_status|
      result = child(<<~RUBY)
        Dir.mktmpdir('controlled-cli-') do |folder|
          file = File.join(folder, 'fake-pod.rb')
          marker = File.join(folder, 'called.json')
          stub = installed_stub(folder, file)
          arguments = ['install', '--literal= spaces ', '--secret=PRIVATE_ARG']
          File.write(file, <<~CLI)
            count = File.exist?(#{'#{marker.inspect}'}) ? JSON.parse(File.read(#{'#{marker.inspect}'}))['count'] : 0
            File.write(#{'#{marker.inspect}'}, JSON.generate({count: count + 1, argumentsPreserved: ARGV == #{'#{arguments.inspect}'}, programPreserved: $PROGRAM_NAME == #{'#{stub.inspect}'}}))
            exit #{exit_status}
          CLI
          Gem.singleton_class.define_method(:bin_path) do |gem, executable|
            raise 'Wrong executable' unless [gem, executable] == ['cocoapods', 'pod']
            file
          end
          ARGV.replace(arguments)
          probe.install(output: output)
          caught = nil
          begin; probe.run_cli; rescue SystemExit => error; caught = error; end
          probe.finish(caught)
          puts JSON.generate({ status: caught&.status, marker: JSON.parse(File.read(marker)),
                               leaked: output.string.include?('PRIVATE_ARG'), stages: decoded(output).map { |line| line['stage'] },
                               termination: decoded(output).last['termination'] })
        end
      RUBY
      assert_equal exit_status, result.fetch('status')
      assert_equal({ 'count' => 1, 'argumentsPreserved' => true, 'programPreserved' => true }, result.fetch('marker'))
      assert_equal false, result.fetch('leaked')
      assert_equal %w[start finish], result.fetch('stages')
      assert_equal exit_status.zero? ? 'exit_success' : 'exit_failure', result.fetch('termination')
    end
  end

  def test_keywords_and_block_are_forwarded_without_extra_invocation
    result = child(<<~RUBY)
      seen = []
      returned = 'same-object'
      callback = proc { 'block-value' }
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) do |*args, **keywords, &block|
          seen << { args: args == ['literal-input'], keywords: keywords == { literal: ' spaces ' }, block: block.equal?(callback) }
          returned
        end
      end)
      probe.install(output: output)
      value = File.realdirpath('literal-input', literal: ' spaces ', &callback)
      probe.finish
      puts JSON.generate({ sameObject: value.equal?(returned), seen: seen })
    RUBY
    assert_equal true, result.fetch('sameObject')
    assert_equal [{ 'args' => true, 'keywords' => true, 'block' => true }], result.fetch('seen')
  end

  def test_closed_schema_counters_metadata_versions_and_repeated_install
    result = child(<<~RUBY)
      spec = Object.new
      spec.define_singleton_method(:version) { 'PRIVATE_VERSION_SENTINEL' }
      Gem.loaded_specs['cocoapods'] = spec
      GC.define_singleton_method(:stat) { |*| 10_000_000_000 }
      error_calls = 0
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) do |*|
          error_calls += 1
          raise Errno::ENOENT, 'PRIVATE_ERROR_SENTINEL' if error_calls <= 2
          raise ArgumentError, 'path name contains null byte'
        end
      end)
      probe.install(output: output)
      probe.install(output: output)
      probe.instance_variable_set(:@calls, 999_999_999)
      probe.instance_variable_set(:@other_path_exceptions, 999_999_999)
      3.times { begin; File.realdirpath('/PRIVATE_PATH_SENTINEL/çã'); rescue StandardError; end }
      probe.finish
      puts JSON.generate({ lines: decoded(output), sizes: output.string.lines.map(&:bytesize),
                           leaked: output.string.include?('PRIVATE_') })
    RUBY
    assert_equal false, result.fetch('leaked')
    assert_equal 3, result.fetch('lines').length
    assert result.fetch('sizes').all? { |size| size <= 2048 }
    start, failure, finish = result.fetch('lines')
    assert_equal %w[gc stage version versions], start.keys.sort
    assert_equal %w[calls category filesystem gc inputBytes inputClass inputNul returnedNul stage version viaPathname], failure.keys.sort
    assert_equal %w[calls firstNulFailure gc otherPathExceptions stage termination version versions], finish.keys.sort
    assert_equal %w[autoCompact collections compactions stress], start.fetch('gc').keys.sort
    assert_equal %w[bundler cocoapods xcodeproj], start.fetch('versions').fetch('gems').keys.sort
    assert_equal 'unknown', finish.fetch('versions').fetch('gems').fetch('cocoapods')
    assert_equal 1_000_000_000, finish.fetch('calls')
    assert_equal 1_000_000_000, start.fetch('gc').fetch('collections')
    assert_equal 1_000_000_000, start.fetch('gc').fetch('compactions')
    assert_equal 'argument_error_nul', failure.fetch('category')
    assert_equal 1_000_000_000, finish.fetch('otherPathExceptions')
  end

  def test_filesystem_failure_and_context_failure_preserve_the_original_error
    %w[filesystem context].each do |mode|
      result = child(<<~RUBY)
        original = ArgumentError.new('path name contains null byte')
        File.singleton_class.prepend(Module.new do
          define_method(:realdirpath) { |*| raise original }
          def exist?(*); raise 'PRIVATE_FILESYSTEM_FAILURE'; end
        end)
        if #{mode.inspect} == 'context'
          probe.define_singleton_method(:begin_call) { |*| raise 'PRIVATE_CONTEXT_FAILURE' }
        end
        probe.install(output: output)
        caught = nil
        begin; File.realdirpath('/bounded'); rescue Exception => error; caught = error; end
        probe.finish(caught)
        puts JSON.generate({ sameError: caught.equal?(original), failure: decoded(output)[1], leaked: output.string.include?('PRIVATE_') })
      RUBY
      assert_equal true, result.fetch('sameError')
      assert_equal false, result.fetch('leaked')
      assert_equal(mode == 'filesystem' ? 'unavailable' : 'skipped', result.fetch('failure').fetch('filesystem').fetch('state'))
    end
  end

  def test_main_entrypoint_keeps_process_exit_with_unavailable_output
    [0, 23].each do |exit_code|
      [false, true].each do |bad_output|
        Dir.mktmpdir('controlled-pod-main-') do |folder|
          cli = File.join(folder, 'pod.rb')
          preload = File.join(folder, 'preload.rb')
          marker = File.join(folder, 'calls.json')
          stub = File.join(folder, 'bin', 'pod')
          Dir.mkdir(File.dirname(stub))
          File.write(stub, "require 'rubygems'; load Gem.bin_path('cocoapods', 'pod')\n")
          arguments = ['install', '--literal= spaces ', '--private=PRIVATE_ARG']
          File.write(cli, <<~RUBY)
            require 'json'
            previous = File.exist?(#{marker.inspect}) ? JSON.parse(File.read(#{marker.inspect}))['count'] : 0
            File.write(#{marker.inspect}, JSON.generate({count: previous + 1, args: ARGV == #{arguments.inspect}, program: $PROGRAM_NAME == #{stub.inspect}}))
            exit #{exit_code}
          RUBY
          File.write(preload, <<~RUBY)
            require 'rubygems'
            Gem.loaded_specs['cocoapods'] = Struct.new(:base_dir, :version).new(#{folder.inspect}, Gem::Version.new('1.15.2'))
            Gem.define_singleton_method(:bindir) { |base| File.join(base, 'bin') }
            Gem.define_singleton_method(:bin_path) do |gem, executable|
              raise 'Unexpected CLI' unless [gem, executable] == ['cocoapods', 'pod']
              #{cli.inspect}
            end
            if #{bad_output}
              require 'stringio'
              output = StringIO.new
              output.define_singleton_method(:write) { |*| raise IOError, 'PRIVATE_IO' }
              $stderr = output
            end
          RUBY
          stdout, stderr, status = Open3.capture3(RbConfig.ruby, '-r', preload, SOURCE, *arguments)
          assert_equal exit_code, status.exitstatus
          assert_equal({ 'count' => 1, 'args' => true, 'program' => true }, JSON.parse(File.read(marker)))
          assert_empty stdout
          refute_includes stderr, 'PRIVATE_'
          assert_equal bad_output ? 0 : 2, stderr.lines.length
          stderr.lines.each do |line|
            assert line.start_with?('POD_PATH_PROBE:')
            assert line.bytesize <= 2048
            JSON.parse(line.delete_prefix('POD_PATH_PROBE:'))
          end
        end
      end
    end
  end

  def test_cli_exit_hooks_run_before_final_diagnostic_without_changing_exit
    Dir.mktmpdir('controlled-cli-exit-hook-') do |folder|
      cli = File.join(folder, 'pod.rb')
      preload = File.join(folder, 'preload.rb')
      stub = File.join(folder, 'bin', 'pod')
      Dir.mkdir(File.dirname(stub))
      File.write(stub, "require 'rubygems'; load Gem.bin_path('cocoapods', 'pod')\n")
      File.write(cli, "at_exit { exit 19 }; exit 0\n")
      File.write(preload, <<~RUBY)
        require 'rubygems'
        Gem.loaded_specs['cocoapods'] = Struct.new(:base_dir, :version).new(#{folder.inspect}, Gem::Version.new('1.15.2'))
        Gem.define_singleton_method(:bindir) { |base| File.join(base, 'bin') }
        Gem.define_singleton_method(:bin_path) { |*| #{cli.inspect} }
      RUBY
      stdout, stderr, status = Open3.capture3(RbConfig.ruby, '-r', preload, SOURCE, 'install')
      assert_equal 19, status.exitstatus
      assert_empty stdout
      lines = stderr.lines.map { |line| JSON.parse(line.delete_prefix('POD_PATH_PROBE:')) }
      assert_equal %w[start finish], lines.map { |line| line.fetch('stage') }
      assert_equal 'exit_failure', lines.last.fetch('termination')
    end
  end

  def test_official_cocoapods_bootstrap_guard_keeps_application_bundle
    result = child(<<~RUBY)
      Dir.mktmpdir('controlled-cli-bootstrap-') do |folder|
        cli = File.join(folder, 'gem', 'bin', 'pod')
        stub = File.join(folder, 'bin', 'pod')
        marker = File.join(folder, 'bootstrap.json')
        FileUtils.mkdir_p(File.dirname(cli))
        FileUtils.mkdir_p(File.dirname(stub))
        File.write(stub, <<~STUB)
          load Gem.bin_path('cocoapods', 'pod')
        STUB
        File.write(cli, <<~CLI)
          if $PROGRAM_NAME == __FILE__
            ENV['BUNDLE_GEMFILE'] = 'CONTROLLED_GEM_DEVELOPMENT_FILE'
          end
          File.write(#{'#{marker.inspect}'}, JSON.generate({applicationBundlePreserved: ENV['BUNDLE_GEMFILE'] == 'CONTROLLED_APP_FILE', internalGuard: $PROGRAM_NAME == __FILE__, installedStubName: $PROGRAM_NAME == #{'#{stub.inspect}'}}))
          exit 0
        CLI
        spec = Struct.new(:base_dir, :version).new(folder, Gem::Version.new('1.15.2'))
        Gem.loaded_specs['cocoapods'] = spec
        Gem.define_singleton_method(:bindir) { |base| File.join(base, 'bin') }
        Gem.define_singleton_method(:bin_path) { |*| cli }
        ENV['BUNDLE_GEMFILE'] = 'CONTROLLED_APP_FILE'
        probe.install(output: output)
        begin; probe.run_cli; rescue SystemExit; end
        probe.finish
        puts File.read(marker)
      end
    RUBY
    assert_equal true, result.fetch('applicationBundlePreserved')
    assert_equal false, result.fetch('internalGuard')
    assert_equal true, result.fetch('installedStubName')
  end

  def test_generated_rubygems_stub_bootstrap_runs_fixture_cli_once
    result = child(<<~RUBY)
      require 'rubygems/installer'
      require 'rubygems/user_interaction'
      Dir.mktmpdir('controlled-generated-gem-stub-') do |folder|
        spec = Gem::Specification.new do |item|
          item.name = 'cocoapods'
          item.version = '1.15.2'
          item.summary = 'Controlled fake CLI, not the CocoaPods product'
          item.authors = ['Controlled fixture']
          item.files = ['bin/pod']
          item.executables = ['pod']
        end
        spec.loaded_from = File.join(folder, 'specifications', 'cocoapods-1.15.2.gemspec')
        FileUtils.mkdir_p(File.dirname(spec.loaded_from))
        File.write(spec.loaded_from, spec.to_ruby)
        Gem.use_paths(folder, [folder, *Gem.path])
        Gem::Specification.reset
        cli = File.join(spec.full_gem_path, 'bin', 'pod')
        FileUtils.mkdir_p(File.dirname(cli))
        marker = File.join(folder, 'called.json')
        arguments = ['install', '--literal= spaces ']
        File.write(cli, <<~CLI)
          #!/usr/bin/env ruby
          if $PROGRAM_NAME == __FILE__
            ENV['BUNDLE_GEMFILE'] = 'CONTROLLED_WRONG_DEVELOPMENT_GEMFILE'
          end
          count = File.exist?(#{'#{marker.inspect}'}) ? JSON.parse(File.read(#{'#{marker.inspect}'}))['count'] : 0
          File.write(#{'#{marker.inspect}'}, JSON.generate({count: count + 1, args: ARGV == #{'#{arguments.inspect}'}, bundle: ENV['BUNDLE_GEMFILE'] == 'CONTROLLED_APP_GEMFILE', internalGuard: $PROGRAM_NAME == __FILE__}))
          exit 27
        CLI
        Gem::DefaultUserInteraction.use_ui(Gem::SilentUI.new) do
          Gem::Installer.for_spec(spec, install_dir: folder, wrappers: true).generate_bin
        end
        stub = File.join(Gem.bindir(spec.base_dir), 'pod')
        generated = File.read(stub).include?('activate_bin_path')
        Gem.loaded_specs['cocoapods'] = spec
        ENV['BUNDLE_GEMFILE'] = 'CONTROLLED_APP_GEMFILE'
        ARGV.replace(arguments)
        probe.install(output: output)
        caught = nil
        begin; probe.run_cli; rescue SystemExit => error; caught = error; end
        probe.finish(caught)
        puts JSON.generate({ generatedOfficialStub: generated, exit: caught&.status, marker: JSON.parse(File.read(marker)),
                             installedName: $PROGRAM_NAME == stub, leaked: output.string.include?('CONTROLLED_APP_GEMFILE') })
      end
    RUBY
    assert_equal true, result.fetch('generatedOfficialStub')
    assert_equal 27, result.fetch('exit')
    assert_equal({ 'count' => 1, 'args' => true, 'bundle' => true, 'internalGuard' => false }, result.fetch('marker'))
    assert_equal true, result.fetch('installedName')
    assert_equal false, result.fetch('leaked')
  end

  def test_handled_enoent_does_not_consume_first_nul_diagnostic
    result = child(<<~RUBY)
      calls = 0
      metadata = []
      File.singleton_class.prepend(Module.new do
        define_method(:realdirpath) do |*|
          calls += 1
          raise Errno::ENOENT if calls == 1
          "controlled\0return"
        end
        define_method(:exist?) { |path| metadata << (path == '/target-nul'); true }
        define_method(:directory?) { |path| metadata << (path == '/target-nul'); true }
        define_method(:file?) { |path| metadata << (path == '/target-nul'); false }
      end)
      probe.install(output: output)
      begin; File.realdirpath('/handled-enoent'); rescue Errno::ENOENT; end
      caught = nil
      begin; Pathname.new('/target-nul').realdirpath; rescue ArgumentError => error; caught = error; end
      probe.finish(caught)
      puts JSON.generate({ terminal: caught&.message == 'pathname contains null byte', calls: calls,
                           lines: decoded(output), metadata: metadata })
    RUBY
    assert_equal true, result.fetch('terminal')
    assert_equal 2, result.fetch('calls')
    assert_equal 3, result.fetch('lines').length
    first_nul = result.fetch('lines')[1]
    assert_equal 'returned_nul', first_nul.fetch('category')
    assert_equal 'first_nul_failure', first_nul.fetch('stage')
    assert_equal false, first_nul.fetch('inputNul')
    assert_equal true, first_nul.fetch('returnedNul')
    assert_equal [true, true, true], result.fetch('metadata')
    assert_equal 1, result.fetch('lines').last.fetch('otherPathExceptions')
  end
end
