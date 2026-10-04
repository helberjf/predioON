# Observe the official CocoaPods CLI in this process without changing its resolver.
require 'json'
require 'pathname'
require 'rubygems'

module PredioOnPodPathProbe
  PREFIX = 'POD_PATH_PROBE:'.freeze
  MAX_LINE_BYTES = 2048
  MAX_COUNTER = 1_000_000_000
  MAX_INPUT_BYTES = 8192
  THREAD_DEPTH = :predioon_pod_path_depth
  THREAD_COLLECTING = :predioon_pod_path_collecting

  module FileObserver
    def realdirpath(*arguments, **keywords, &block)
      return super if Thread.current.thread_variable_get(THREAD_COLLECTING)

      context = PredioOnPodPathProbe.safely { PredioOnPodPathProbe.begin_call(arguments) }
      begin
        result = super
      rescue Exception => original
        PredioOnPodPathProbe.safely do
          if PredioOnPodPathProbe.nul_exception?(original)
            PredioOnPodPathProbe.failure(context, nil, original)
          else
            PredioOnPodPathProbe.other_exception
          end
        end
        raise
      else
        PredioOnPodPathProbe.safely do
          if result.instance_of?(String) && result.include?("\0")
            PredioOnPodPathProbe.failure(context, result, nil)
          end
        end
        result
      end
    end
  end

  module PathnameObserver
    def realdirpath(...)
      previous = PredioOnPodPathProbe.safely do
        value = Thread.current.thread_variable_get(THREAD_DEPTH)
        depth = value.instance_of?(Integer) ? value : 0
        Thread.current.thread_variable_set(THREAD_DEPTH, [depth + 1, MAX_COUNTER].min)
        value
      end
      begin
        super
      ensure
        PredioOnPodPathProbe.safely { Thread.current.thread_variable_set(THREAD_DEPTH, previous) }
      end
    end
  end

  class << self
    # A failure in observation must not change a resolver/CLI outcome, including exit.
    # This rescue is confined to diagnostics; the resolver and CLI are outside it.
    def safely
      yield
    rescue Exception
      nil
    end

    def install(output: $stderr)
      return if @installed

      @output = output
      @calls = 0
      @other_path_exceptions = 0
      @first_failure = false
      @finished = false
      @installed = true
      File.singleton_class.prepend(FileObserver)
      Pathname.prepend(PathnameObserver)
      safely { emit('start', { 'gc' => gc_snapshot, 'versions' => versions }) }
    end

    def capped(value)
      return 0 unless value.instance_of?(Integer) && value >= 0

      value > MAX_COUNTER ? MAX_COUNTER : value
    end

    def gc_snapshot
      stress = GC.stress
      {
        'stress' => stress == false ? 'false' : stress == true ? 'true' : stress.instance_of?(Integer) ? 'integer' : 'unknown',
        'autoCompact' => GC.auto_compact == true,
        'collections' => capped(GC.stat(:count)),
        'compactions' => capped(GC.stat(:compact_count))
      }
    end

    def version(value)
      text = value.to_s
      text.bytesize <= 24 && /\A\d+\.\d+\.\d+(?:\.\d+)?\z/.match?(text) ? text : 'unknown'
    end

    def versions
      gems = %w[bundler cocoapods xcodeproj].to_h do |name|
        spec = Gem.loaded_specs[name]
        [name, spec ? version(spec.version) : 'not_loaded']
      end
      { 'ruby' => version(RUBY_VERSION), 'gems' => gems }
    end

    def begin_call(arguments)
      @calls += 1 if @calls < MAX_COUNTER
      argument = arguments.first
      input_class = argument.instance_of?(String) ? 'string' : argument.instance_of?(Pathname) ? 'pathname' : 'other'
      # File performs any to_path conversion itself. Never convert an observer input.
      raw = argument.instance_of?(String) ? argument : nil
      size = raw ? raw.bytesize : nil
      bounded = size && size <= MAX_INPUT_BYTES
      input_nul = bounded ? raw.include?("\0") : nil
      band = size.nil? ? 'unknown' : size.zero? ? '0' : size <= 1024 ? '1-1024' : size <= MAX_INPUT_BYTES ? '1025-8192' : 'over-8192'
      depth = Thread.current.thread_variable_get(THREAD_DEPTH)
      {
        'inputClass' => input_class, 'inputBytes' => band, 'inputNul' => input_nul,
        'viaPathname' => depth.instance_of?(Integer) && depth.positive?,
        'raw' => raw, 'filesystemAllowed' => bounded && !input_nul && (arguments.length < 2 || arguments[1].nil?)
      }
    end

    def filesystem(context)
      return { 'state' => 'skipped', 'exists' => nil, 'directory' => nil, 'file' => nil } unless context && context['filesystemAllowed']

      raw = context.fetch('raw')
      { 'state' => 'observed', 'exists' => File.exist?(raw), 'directory' => File.directory?(raw), 'file' => File.file?(raw) }
    rescue Exception
      { 'state' => 'unavailable', 'exists' => nil, 'directory' => nil, 'file' => nil }
    end

    def nul_exception?(error)
      error.is_a?(ArgumentError) && ['path name contains null byte', 'pathname contains null byte'].include?(error.message)
    end

    def other_exception
      @other_path_exceptions += 1 if @other_path_exceptions < MAX_COUNTER
    end

    def failure(context, result, error)
      return if @first_failure

      @first_failure = true
      previous = Thread.current.thread_variable_get(THREAD_COLLECTING)
      Thread.current.thread_variable_set(THREAD_COLLECTING, true)
      begin
        details = {
          'category' => error ? 'argument_error_nul' : 'returned_nul',
          'inputClass' => context ? context['inputClass'] : 'other',
          'inputBytes' => context ? context['inputBytes'] : 'unknown',
          'inputNul' => context ? context['inputNul'] : nil,
          'viaPathname' => context ? context['viaPathname'] : false,
          'returnedNul' => result.instance_of?(String) ? result.include?("\0") : nil,
          'filesystem' => filesystem(context), 'gc' => gc_snapshot,
          'calls' => capped(@calls)
        }
        emit('first_nul_failure', details)
      ensure
        Thread.current.thread_variable_set(THREAD_COLLECTING, previous)
      end
    end

    def emit(stage, details)
      line = PREFIX + JSON.generate({ 'version' => 1, 'stage' => stage }.merge(details)) + "\n"
      raise 'Diagnostic schema limit exceeded' if line.bytesize > MAX_LINE_BYTES

      @output.write(line)
    end

    def finish(error = nil)
      return if @finished

      @finished = true
      safely do
        termination = error.is_a?(SystemExit) ? error.success? ? 'exit_success' : 'exit_failure' : error ? 'unhandled_exception' : 'returned'
        emit('finish', { 'termination' => termination, 'calls' => capped(@calls),
                         'firstNulFailure' => @first_failure == true,
                         'otherPathExceptions' => capped(@other_path_exceptions),
                         'gc' => gc_snapshot, 'versions' => versions })
      end
    end

    def run_cli
      install
      # Registered before the CLI, so its later exit hooks run before this summary.
      at_exit { finish($!) }
      # Bundler has activated this specification. Load its installed RubyGems stub,
      # which performs the normal executable bootstrap and loads the internal CLI.
      # Setting $0 to the internal gem bin would activate CocoaPods' dev Gemfile.
      spec = Gem.loaded_specs.fetch('cocoapods')
      stub = File.join(Gem.bindir(spec.base_dir), 'pod')
      $PROGRAM_NAME = stub
      load stub
    end
  end
end

PredioOnPodPathProbe.run_cli if $PROGRAM_NAME == __FILE__
