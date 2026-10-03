#!/usr/bin/env bash
# Disposable macOS CI cluster. No package-manager service or existing cluster.
set +x
set -euo pipefail
umask 077
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == macOS && -n "${RUNNER_TEMP:-}" ]] || { echo 'Disposable macOS CI runner required' >&2; exit 1; }
runner_temp=$(cd "$RUNNER_TEMP" && pwd -P)
action=${1:-}
if [[ "$action" == stop ]]; then
  [[ -n "${IOS_DB_ROOT:-}" && -d "$IOS_DB_ROOT" ]] || exit 0
  cluster_root=$(cd "$IOS_DB_ROOT" && pwd -P)
  [[ "$cluster_root" == "$runner_temp"/predioon-ios-db.* && -f "$cluster_root/.owned-ci-cluster" ]] || { echo 'Unowned cluster refused' >&2; exit 1; }
  if [[ -f "$cluster_root/data/postmaster.pid" ]]; then
    "$cluster_root/pg16/bin/pg_ctl" -D "$cluster_root/data" -m fast -w -t 60 stop > "$cluster_root/stop.log" 2>&1
  fi
  exit 0
fi
[[ "$action" == start ]] || { echo 'Expected start or stop' >&2; exit 1; }
[[ -n "${IOS_DB_PASSWORD:-}" ]] || { echo 'Ephemeral database password required' >&2; exit 1; }
cluster_root=$(mktemp -d "$runner_temp/predioon-ios-db.XXXXXX")
touch "$cluster_root/.owned-ci-cluster"
printf 'IOS_DB_ROOT=%s\n' "$cluster_root" >> "$GITHUB_ENV"
run_build_step() {
  local stage=$1 log=$2
  shift 2
  if "$@" > "$cluster_root/$log" 2>&1; then
    printf 'Pinned database build stage completed: %s\n' "$stage"
  else
    local code=$?
    # Never print command arguments or raw output, even if classification fails.
    if ! python3 "$script_directory/build_diagnostic.py" "$stage" "$code" "$cluster_root" "$runner_temp" 2> "$cluster_root/diagnostic.log"; then
      printf '{"stage":"%s","exitCode":%s,"category":"private_log_unavailable","hint":"The owned private compilation log could not be safely inspected."}\n' "$stage" "$code"
    fi
    return "$code"
  fi
}
pg_sha=971766d645aa73e93b9ef4e3be44201b4f45b5477095b049125403f9f3386d6f
ts_sha=85dd01deaa0728f95d117c1a75ca0cbf78f3301e6ab2b98bebe5f7c95b793acb
curl --fail --location --retry 3 --max-time 180 https://ftp.postgresql.org/pub/source/v16.4/postgresql-16.4.tar.bz2 -o "$cluster_root/postgresql.tar.bz2"
curl --fail --location --retry 3 --max-time 180 https://codeload.github.com/timescale/timescaledb/tar.gz/b359d26de186ea43f93c28c08cd1b8c6449c91bd -o "$cluster_root/timescaledb.tar.gz"
printf '%s  %s\n' "$pg_sha" "$cluster_root/postgresql.tar.bz2" | shasum -a 256 -c -
printf '%s  %s\n' "$ts_sha" "$cluster_root/timescaledb.tar.gz" | shasum -a 256 -c -
tar -xjf "$cluster_root/postgresql.tar.bz2" -C "$cluster_root"
mkdir "$cluster_root/timescale"
tar -xzf "$cluster_root/timescaledb.tar.gz" --strip-components=1 -C "$cluster_root/timescale"
openssl_prefix=$(brew --prefix openssl@3)
cd "$cluster_root/postgresql-16.4"
run_build_step postgres-configure configure.log ./configure --prefix="$cluster_root/pg16" --with-ssl=openssl --with-includes="$openssl_prefix/include" --with-libraries="$openssl_prefix/lib" --without-icu --without-readline
run_build_step postgres-build postgres-build.log make -j2
run_build_step postgres-install postgres-install.log make install
run_build_step btree-gist-install btree-gist-install.log make -C contrib/btree_gist install
cd "$cluster_root/timescale"
run_build_step timescale-configure timescale-configure.log ./bootstrap -DPG_CONFIG="$cluster_root/pg16/bin/pg_config" -DCMAKE_BUILD_TYPE=Release -DREGRESS_CHECKS=OFF -DTAP_CHECKS=OFF -DSEND_TELEMETRY_DEFAULT=OFF
run_build_step timescale-build timescale-build.log cmake --build build --parallel 2
run_build_step timescale-install timescale-install.log cmake --build build --target install
printf '%s' "$IOS_DB_PASSWORD" > "$cluster_root/password"
"$cluster_root/pg16/bin/initdb" -D "$cluster_root/data" -U predioon --auth-local=trust --auth-host=scram-sha-256 --pwfile="$cluster_root/password" > "$cluster_root/initdb.log" 2>&1
mkdir "$cluster_root/socket"
cat >> "$cluster_root/data/postgresql.conf" <<EOF
listen_addresses = '127.0.0.1'
port = 5436
unix_socket_directories = '$cluster_root/socket'
shared_preload_libraries = 'timescaledb'
timescaledb.telemetry_level = 'off'
EOF
"$cluster_root/pg16/bin/pg_ctl" -D "$cluster_root/data" -l "$cluster_root/postgres.log" -w -t 60 start
export PGPASSWORD="$IOS_DB_PASSWORD"
"$cluster_root/pg16/bin/createdb" -h 127.0.0.1 -p 5436 -U predioon predioon
"$cluster_root/pg16/bin/psql" -X -h 127.0.0.1 -p 5436 -U predioon -d predioon -v ON_ERROR_STOP=1 -c 'CREATE EXTENSION timescaledb; CREATE EXTENSION btree_gist;'
actual=$("$cluster_root/pg16/bin/psql" -X -h 127.0.0.1 -p 5436 -U predioon -d predioon -At -v ON_ERROR_STOP=1 -c "select current_setting('server_version_num') || ':' || extversion from pg_extension where extname='timescaledb'")
[[ "$actual" == '160004:2.17.2' ]] || { echo 'Pinned database version mismatch' >&2; exit 1; }
printf '{"postgres":"16.4","timescale":"2.17.2","postgresSha256":"%s","timescaleSha256":"%s"}\n' "$pg_sha" "$ts_sha" > "$cluster_root/source-versions.json"
echo 'Pinned disposable PostgreSQL/Timescale cluster ready on loopback:5436'
