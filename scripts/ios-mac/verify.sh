#!/bin/bash
# Verifies the iOS apps on a Mac and writes a report: checks or installs the
# prerequisites, runs the JavaScript and helper tests, builds both apps for the
# simulator and opens them there, and optionally installs on an iPhone by cable,
# uploads to TestFlight and publishes the report to a GitHub branch.
#
#   scripts/ios-mac/verify.sh --help
#
# Written for the bash 3.2 that ships with macOS: no associative arrays.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/ios-mac"
STAMP="$(date +%Y%m%d-%H%M%S)"
WORK="$ROOT/.local/ios-mac"
OUT="$WORK/$STAMP"
SMOKE_ORIGIN="https://smoke-api.invalid"
PNPM="pnpm@10.17.1"
CONFIGS=(apps/resident-mobile/config.ts apps/operations-mobile/config.ts)

YES=0
APPS="resident-mobile operations-mobile"
API_URL=""
DEVICE=0
TEAM=""
TESTFLIGHT=0
BUILD_NUMBER=""
PUBLISH=0
SIMULATOR=1

usage() {
  cat <<'EOF'
Uso: scripts/ios-mac/verify.sh [opções]

Sem opções: confere os pré-requisitos (e oferece instalar o que faltar), roda os
testes, compila os dois apps para o simulador, abre cada um e gera o relatório
em .local/ios-mac/<data>/report.md, mais um .zip para enviar.

  --yes                  instala o que faltar sem perguntar
  --app NOME             resident, operations ou both (padrão: both)
  --skip-simulator       não compila nem abre no simulador
  --device               instala no iPhone conectado por cabo (Apple ID gratuito
                         serve; vale 7 dias). Exige --api-url
  --testflight           envia ao TestFlight (conta Apple paga). Exige --api-url
                         e as variáveis ASC_KEY_ID, ASC_ISSUER_ID e ASC_KEY_PATH
  --api-url URL          origem HTTPS da API usada no iPhone/TestFlight
  --team ID              Team ID da Apple (detectado sozinho se houver só um)
  --build-number N       número do build no TestFlight (padrão: data e hora)
  --publish              envia o relatório para a branch relatorios/ios-mac-<data>
  -h, --help             mostra esta ajuda
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --app)
      shift
      case "${1:-}" in
        resident) APPS="resident-mobile" ;;
        operations) APPS="operations-mobile" ;;
        both) APPS="resident-mobile operations-mobile" ;;
        *) echo "--app: use resident, operations ou both" >&2; exit 2 ;;
      esac ;;
    --skip-simulator) SIMULATOR=0 ;;
    --device) DEVICE=1 ;;
    --testflight) TESTFLIGHT=1 ;;
    --api-url) shift; API_URL="${1:-}" ;;
    --team) shift; TEAM="${1:-}" ;;
    --build-number) shift; BUILD_NUMBER="${1:-}" ;;
    --publish) PUBLISH=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Opção desconhecida: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Este script roda só no macOS." >&2
  exit 2
fi
if { [ "$DEVICE" = 1 ] || [ "$TESTFLIGHT" = 1 ]; } && [ -z "$API_URL" ]; then
  echo "--device e --testflight exigem --api-url https://... (a API precisa estar acessível pelo iPhone)." >&2
  exit 2
fi
if [ "$TESTFLIGHT" = 1 ]; then
  for variable in ASC_KEY_ID ASC_ISSUER_ID ASC_KEY_PATH; do
    if [ -z "${!variable:-}" ]; then
      echo "--testflight exige a variável $variable (veja scripts/ios-mac/README.md)." >&2
      exit 2
    fi
  done
  if [ ! -f "$ASC_KEY_PATH" ]; then
    echo "ASC_KEY_PATH não aponta para o arquivo .p8 da chave do App Store Connect." >&2
    exit 2
  fi
  BUILD_NUMBER="${BUILD_NUMBER:-$(date +%Y%m%d%H%M)}"
  ASC_AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

cd "$ROOT" || exit 2
if ! git diff --quiet -- "${CONFIGS[@]}"; then
  echo "Há alterações locais em config.ts. Faça commit ou descarte antes: o script reescreve esse arquivo temporariamente." >&2
  exit 2
fi

mkdir -p "$OUT/logs" "$OUT/captures" || exit 2
: >"$OUT/steps.tsv"
: >"$OUT/env.tsv"

# ---------------------------------------------------------------- helpers

app_scheme() {
  case "$1" in
    resident-mobile) echo PredioONMorador ;;
    operations-mobile) echo PredioONOperacao ;;
  esac
}
app_bundle() {
  case "$1" in
    resident-mobile) echo com.predioon.resident ;;
    operations-mobile) echo com.predioon.operations ;;
  esac
}

say() { printf '%s\n' "$*" | tee -a "$OUT/logs/prerequisites.log"; }
note() { printf '%s\t%s\n' "$1" "$2" >>"$OUT/env.tsv"; }
record() { printf '%s\t%s\t%s\t%s\t%s\n' "$1" "$2" "$3" "$4" "$5" >>"$OUT/steps.tsv"; }

confirm() {
  [ "$YES" = 1 ] && return 0
  [ -r /dev/tty ] || return 1
  local answer
  printf '%s [s/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || return 1
  case "$answer" in s|S|sim|Sim|y|Y|yes) return 0 ;; esac
  return 1
}

# run_step ID TITLE COMMAND...: runs COMMAND with its output in logs/ID.log.
run_step() {
  local id="$1" title="$2" start status
  shift 2
  start=$(date +%s)
  printf '\n▶ %s\n' "$title"
  if "$@" >"$OUT/logs/$id.log" 2>&1; then status=ok; else status=fail; fi
  record "$id" "$status" "$(( $(date +%s) - start ))" "logs/$id.log" "$title"
  if [ "$status" = ok ]; then
    printf '  ✔ ok\n'
    return 0
  fi
  printf '  ✘ falhou. Últimas linhas de logs/%s.log:\n' "$id"
  tail -n 15 "$OUT/logs/$id.log" | sed 's/^/    /'
  return 1
}
skip_step() {
  record "$1" skip 0 "" "$2 ($3)"
  printf '\n▷ %s: pulado (%s)\n' "$2" "$3"
}

# The release reads the API origin from the committed config.ts literal; the
# same validated rewrite as the EAS hook, undone right after each build.
configure_origin() {
  CONFIG_FILE="$ROOT/apps/$1/config.ts" API_ORIGIN="$2" ORIGIN_MODULE="$ROOT/scripts/eas-api-origin.mjs" \
    node --input-type=module -e '
      const { pathToFileURL } = await import("node:url");
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { apiOrigin, configureSource } = await import(pathToFileURL(process.env.ORIGIN_MODULE).href);
      const file = process.env.CONFIG_FILE;
      writeFileSync(file, configureSource(readFileSync(file, "utf8"), apiOrigin(process.env.API_ORIGIN)));'
}
restore_configs() { git -C "$ROOT" checkout -- "${CONFIGS[@]}" 2>/dev/null; }

# A free Apple ID registers the bundle ID it signs. The cable install uses a
# ".dev" suffix so com.predioon.* stays free for the paid App Store account.
project_file() { echo "$ROOT/apps/$1/ios/$(app_scheme "$1").xcodeproj/project.pbxproj"; }
use_dev_bundle() {
  local bundle
  bundle="$(app_bundle "$1")"
  sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = \"$bundle\";/PRODUCT_BUNDLE_IDENTIFIER = \"$bundle.dev\";/" "$(project_file "$1")"
}
restore_bundle() {
  local bundle
  bundle="$(app_bundle "$1")"
  sed -i '' "s/PRODUCT_BUNDLE_IDENTIFIER = \"$bundle\\.dev\";/PRODUCT_BUNDLE_IDENTIFIER = \"$bundle\";/" "$(project_file "$1")"
}

cleanup() {
  local app
  restore_configs
  for app in resident-mobile operations-mobile; do restore_bundle "$app"; done
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# ---------------------------------------------------------- prerequisites

PREREQUISITES_OK=1
missing() { say "✘ $1"; PREREQUISITES_OK=0; }

BREW=""
for candidate in "$(command -v brew 2>/dev/null)" /opt/homebrew/bin/brew /usr/local/bin/brew; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then BREW="$candidate"; break; fi
done
[ -n "$BREW" ] && eval "$("$BREW" shellenv)"

node_ok() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor] = process.versions.node.split(".").map(Number);
    process.exit((major === 22 && minor >= 13) || (major === 24 && minor >= 3) || major >= 26 ? 0 : 1);'
}
ruby_ok() {
  command -v ruby >/dev/null 2>&1 && command -v bundle >/dev/null 2>&1 \
    && ruby -e 'exit(Gem::Version.new(RUBY_VERSION) >= Gem::Version.new("3.0") ? 0 : 1)'
}
python_ok() { command -v python3 >/dev/null 2>&1 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; }

# use_formula FORMULA LABEL CHECK: puts an installed Homebrew keg on PATH, or offers to install it.
use_formula() {
  local formula="$1" label="$2" check="$3" prefix
  "$check" && return 0
  if [ -z "$BREW" ]; then
    missing "$label ausente e Homebrew não instalado. Instale o Homebrew (https://brew.sh) e rode de novo."
    return 1
  fi
  prefix="$("$BREW" --prefix "$formula" 2>/dev/null)"
  if [ -n "$prefix" ] && [ -d "$prefix/bin" ]; then
    PATH="$prefix/bin:$PATH"
    "$check" && return 0
  fi
  if confirm "Instalar $label ($formula) com o Homebrew?"; then
    "$BREW" install "$formula" 2>&1 | tee -a "$OUT/logs/prerequisites.log"
    PATH="$("$BREW" --prefix "$formula")/bin:$PATH"
    "$check" && { say "✔ $label instalado"; return 0; }
  fi
  missing "$label não atende ao requisito"
  return 1
}

prerequisites() {
  local start xcode_app developer free_gb
  start=$(date +%s)
  printf '\n▶ Pré-requisitos\n'

  xcode_app="$(ls -d /Applications/Xcode*.app 2>/dev/null | head -n 1)"
  if [ -z "$xcode_app" ]; then
    missing "Xcode não encontrado: instale pela App Store, abra uma vez e rode de novo."
  else
    developer="$(xcode-select -p 2>/dev/null)"
    case "$developer" in
      *.app/Contents/Developer) ;;
      *)
        if confirm "O Mac usa só as Command Line Tools. Selecionar $xcode_app (pede a senha do Mac)?"; then
          sudo xcode-select -s "$xcode_app/Contents/Developer" || missing "xcode-select falhou"
        else
          missing "Selecione o Xcode: sudo xcode-select -s $xcode_app/Contents/Developer"
        fi ;;
    esac
    if ! xcodebuild -license check >/dev/null 2>&1; then
      if confirm "Aceitar a licença do Xcode (pede a senha do Mac)?"; then
        sudo xcodebuild -license accept || missing "Licença do Xcode não aceita"
      else
        missing "Aceite a licença: sudo xcodebuild -license accept"
      fi
    fi
    if ! xcodebuild -checkFirstLaunchStatus >/dev/null 2>&1; then
      if confirm "Concluir a primeira inicialização do Xcode (pede a senha do Mac)?"; then
        sudo xcodebuild -runFirstLaunch || missing "Primeira inicialização do Xcode falhou"
      else
        missing "Rode: sudo xcodebuild -runFirstLaunch"
      fi
    fi
    if [ "$SIMULATOR" = 1 ] && ! xcrun simctl list runtimes available 2>/dev/null | grep -q '^iOS'; then
      if confirm "Nenhum simulador de iOS instalado. Baixar agora (vários GB)?"; then
        xcodebuild -downloadPlatform iOS 2>&1 | tee -a "$OUT/logs/prerequisites.log" || missing "Download do simulador falhou"
      else
        missing "Instale o simulador de iOS: Xcode > Settings > Components"
      fi
    fi
  fi

  use_formula node@24 "Node 24" node_ok
  use_formula ruby@3.3 "Ruby 3.3" ruby_ok
  python_ok || missing "python3 3.9 ou mais novo não encontrado (vem com o Xcode)"
  command -v git >/dev/null 2>&1 || missing "git não encontrado"

  free_gb="$(df -g "$ROOT" | awk 'NR == 2 { print $4 }')"
  if [ -n "$free_gb" ] && [ "$free_gb" -lt 25 ]; then
    say "⚠ Só ${free_gb} GB livres; o build iOS dos dois apps pode precisar de 20 GB ou mais."
  fi

  note "Mac" "macOS $(sw_vers -productVersion 2>/dev/null) ($(uname -m))"
  note "Xcode" "$(xcodebuild -version 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')"
  note "SDK iOS" "$(xcrun --sdk iphoneos --show-sdk-version 2>/dev/null)"
  note "Node" "$(node --version 2>/dev/null)"
  note "Ruby" "$(ruby --version 2>/dev/null | cut -d' ' -f2)"
  note "Python" "$(python3 --version 2>/dev/null | cut -d' ' -f2)"
  note "pnpm" "$(npx --yes "$PNPM" --version 2>/dev/null)"

  if [ "$PREREQUISITES_OK" = 1 ]; then
    record prerequisites ok "$(( $(date +%s) - start ))" logs/prerequisites.log "Pré-requisitos"
    printf '  ✔ ok\n'
    return 0
  fi
  record prerequisites fail "$(( $(date +%s) - start ))" logs/prerequisites.log "Pré-requisitos"
  return 1
}

# ------------------------------------------------------------------ steps

pnpm_() { npx --yes "$PNPM" "$@"; }
js_install() { pnpm_ install --frozen-lockfile; }
js_tests() { pnpm_ --filter @predioon/api-client --filter @predioon/mobile test; }
js_typecheck() { pnpm_ --filter @predioon/mobile --filter @predioon/resident-mobile --filter @predioon/operations-mobile typecheck; }
helper_tests() {
  node --test scripts/test-eas-api-origin.mjs \
    && node scripts/check-boundaries.mjs \
    && (cd scripts/ios-mac && python3 -m unittest test_report -v) \
    && (cd scripts/ios-smoke && python3 -m unittest test_capture -v)
}

export BUNDLE_PATH="$WORK/bundle"
pods() {
  (
    cd "$ROOT/apps/$1/ios" || exit 1
    export BUNDLE_GEMFILE="$ROOT/apps/$1/Gemfile"
    bundle install && bundle exec pod install
  )
}

simulator_build() {
  local app="$1" scheme status
  scheme="$(app_scheme "$app")"
  configure_origin "$app" "$SMOKE_ORIGIN" || return 1
  xcodebuild -workspace "apps/$app/ios/$scheme.xcworkspace" -scheme "$scheme" -configuration Release \
    -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
    -derivedDataPath "$WORK/build/$app-simulator" CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
  status=$?
  restore_configs
  return "$status"
}
simulator_launch() {
  local scheme
  scheme="$(app_scheme "$1")"
  python3 scripts/ios-smoke/capture.py --allow-local-mac \
    --application "$WORK/build/$1-simulator/Build/Products/Release-iphonesimulator/$scheme.app" \
    --output "$OUT/captures/$1"
}

device_build() {
  local app="$1" scheme status
  scheme="$(app_scheme "$app")"
  use_dev_bundle "$app"
  configure_origin "$app" "$API_URL" || { restore_bundle "$app"; return 1; }
  xcodebuild -workspace "apps/$app/ios/$scheme.xcworkspace" -scheme "$scheme" -configuration Release \
    -destination "id=$DEVICE_UDID" -derivedDataPath "$WORK/build/$app-device" \
    -allowProvisioningUpdates DEVELOPMENT_TEAM="$TEAM" build
  status=$?
  restore_configs
  restore_bundle "$app"
  return "$status"
}
device_install() {
  xcrun devicectl device install app --device "$DEVICE_ID" \
    "$WORK/build/$1-device/Build/Products/Release-iphoneos/$(app_scheme "$1").app"
}

testflight_archive() {
  local app="$1" scheme status
  scheme="$(app_scheme "$app")"
  configure_origin "$app" "$API_URL" || return 1
  xcodebuild -workspace "apps/$app/ios/$scheme.xcworkspace" -scheme "$scheme" -configuration Release \
    -destination 'generic/platform=iOS' -archivePath "$WORK/build/$app-testflight/$scheme.xcarchive" \
    -allowProvisioningUpdates "${ASC_AUTH[@]}" DEVELOPMENT_TEAM="$TEAM" CURRENT_PROJECT_VERSION="$BUILD_NUMBER" archive
  status=$?
  restore_configs
  return "$status"
}
testflight_upload() {
  local directory scheme
  scheme="$(app_scheme "$1")"
  directory="$WORK/build/$1-testflight"
  python3 "$HERE/report.py" export-options --team "$TEAM" --output "$directory/ExportOptions.plist" || return 1
  xcodebuild -exportArchive -archivePath "$directory/$scheme.xcarchive" \
    -exportOptionsPlist "$directory/ExportOptions.plist" -exportPath "$directory/export" \
    -allowProvisioningUpdates "${ASC_AUTH[@]}"
}

publish_report() {
  local branch="relatorios/ios-mac-$STAMP" temporary destination status remote
  if [ -z "$(git config user.email)" ]; then
    echo "Configure o Git antes: git config --global user.name \"Seu Nome\" e git config --global user.email voce@exemplo.com" >&2
    return 1
  fi
  temporary="$(mktemp -d)"
  git worktree add --detach "$temporary/report" HEAD >/dev/null || return 1
  destination="$temporary/report/docs/evidencias/ios-mac/$STAMP"
  python3 "$HERE/report.py" bundle --dir "$OUT" --dest "$destination" \
    && git -C "$temporary/report" add docs/evidencias/ios-mac \
    && git -C "$temporary/report" commit -q -m "docs(ios): Mac verification report $STAMP" \
    && git -C "$temporary/report" push -q origin "HEAD:refs/heads/$branch"
  status=$?
  git worktree remove --force "$temporary/report" >/dev/null 2>&1
  rm -rf "$temporary"
  if [ "$status" = 0 ]; then
    remote="$(git remote get-url origin | sed -e 's#^git@github.com:#https://github.com/#' -e 's#\.git$##')"
    echo "Relatório publicado: $remote/tree/$branch/docs/evidencias/ios-mac/$STAMP"
  fi
  return "$status"
}

# ------------------------------------------------------------------- main

echo "Verificação iOS no Mac — saída em ${OUT#"$ROOT"/}"
note "commit" "$(git rev-parse HEAD)"
note "branch" "$(git rev-parse --abbrev-ref HEAD)"
note "Apps" "$APPS"

if prerequisites; then
  JS_READY=0
  run_step js-install "Instalar dependências JavaScript (pnpm)" js_install && JS_READY=1
  if [ "$JS_READY" = 1 ]; then
    run_step js-tests "Testes do app (packages/mobile e api-client)" js_tests
    run_step js-typecheck "Verificação de tipos dos apps" js_typecheck
    run_step helper-tests "Testes dos scripts de iOS e fronteiras da arquitetura" helper_tests
  fi

  if [ "$DEVICE" = 1 ]; then
    devices="$OUT/logs/devices.json"
    if [ -z "$TEAM" ]; then
      TEAM="$(defaults export com.apple.dt.Xcode - 2>/dev/null | python3 "$HERE/report.py" team --kind any)" || TEAM=""
    fi
    if xcrun devicectl list devices --json-output "$devices" >/dev/null 2>&1 \
      && selected="$(python3 "$HERE/report.py" device "$devices")"; then
      DEVICE_ID="$(printf '%s' "$selected" | cut -f1)"
      DEVICE_UDID="$(printf '%s' "$selected" | cut -f2)"
      note "iPhone" "$(printf '%s' "$selected" | cut -f3)"
    else
      DEVICE_ID=""
    fi
  fi
  if [ "$TESTFLIGHT" = 1 ] && [ -z "$TEAM" ]; then
    TEAM="$(defaults export com.apple.dt.Xcode - 2>/dev/null | python3 "$HERE/report.py" team --kind paid)" || TEAM=""
  fi
  [ "$TESTFLIGHT" = 1 ] && note "Build TestFlight" "$BUILD_NUMBER"

  for app in $APPS; do
    if [ "$JS_READY" != 1 ]; then
      skip_step "pods-$app" "CocoaPods de $app" "dependências JavaScript não instaladas"
      continue
    fi
    run_step "pods-$app" "CocoaPods de $app" pods "$app" || continue

    if [ "$SIMULATOR" = 1 ]; then
      run_step "simulator-build-$app" "Compilar $app para o simulador" simulator_build "$app" \
        && run_step "simulator-launch-$app" "Abrir $app no simulador e conferir a tela de login" simulator_launch "$app"
    else
      skip_step "simulator-$app" "Simulador de $app" "--skip-simulator"
    fi

    if [ "$DEVICE" = 1 ]; then
      if [ -z "$TEAM" ] || [ -z "$DEVICE_ID" ]; then
        record "device-$app" fail 0 "" "Instalar $app no iPhone (sem Team ID ou iPhone conectado; veja o README)"
        printf '\n✘ Instalar %s no iPhone: informe --team e conecte um único iPhone desbloqueado\n' "$app"
      else
        run_step "device-build-$app" "Compilar $app para o iPhone" device_build "$app" \
          && run_step "device-install-$app" "Instalar $app no iPhone" device_install "$app"
      fi
    fi

    if [ "$TESTFLIGHT" = 1 ]; then
      if [ -z "$TEAM" ]; then
        record "testflight-$app" fail 0 "" "Enviar $app ao TestFlight (sem Team ID; use --team)"
        printf '\n✘ Enviar %s ao TestFlight: informe --team\n' "$app"
      else
        run_step "testflight-archive-$app" "Gerar o arquivo de $app para a App Store" testflight_archive "$app" \
          && run_step "testflight-upload-$app" "Enviar $app ao TestFlight" testflight_upload "$app"
      fi
    fi
  done
fi

restore_configs
git status --porcelain >"$OUT/worktree.txt" 2>/dev/null
python3 "$HERE/report.py" render --dir "$OUT"
RESULT=$?
ditto -c -k --keepParent "$OUT" "$OUT.zip" 2>/dev/null

echo
if [ "$RESULT" = 0 ]; then echo "✅ Verificação APROVADA"; else echo "❌ Verificação REPROVADA (veja as etapas com falha)"; fi
echo "Relatório: ${OUT#"$ROOT"/}/report.md"
echo "Para enviar por e-mail ou WhatsApp: ${OUT#"$ROOT"/}.zip"
if [ "$PUBLISH" = 1 ]; then
  publish_report || echo "Não consegui publicar no GitHub (precisa de acesso de escrita ao repositório). Envie o .zip acima."
fi
if [ "$DEVICE" = 1 ]; then
  echo "No iPhone: Ajustes > Geral > VPN e Gerenciamento de Dispositivo > confie no desenvolvedor antes de abrir o app."
fi
if [ "$TESTFLIGHT" = 1 ] && [ "$RESULT" = 0 ]; then
  echo "TestFlight: a Apple processa o build em 10 a 30 minutos; depois ele aparece no app TestFlight do iPhone."
fi
exit "$RESULT"
