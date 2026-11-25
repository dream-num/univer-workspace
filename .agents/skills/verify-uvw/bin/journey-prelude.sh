# Sourced first by the driver of each journey that bin/journeys.mjs runs. The recipe's blocks then run as written:
# from the repository root, with the run's environment, without errexit or pipefail, and with stdin closed.
# A command that fails outside a condition is a broken check, unless the next command reads $?.
# journeys.mjs sets VU_REPO, VU_STATE, VU_FAILS, VU_LOG and VU_CUR, and reads VU_FAILS as the record.
exec </dev/null
cd "$VU_REPO" || exit 90
V=.agents/skills/verify-uvw/bin/verify-uvw
__vu_e=$("$V" env) || exit 91
eval "$__vu_e"
__vu_env=" $(compgen -v | tr '\n' ' ') "
[ ! -f "$VU_STATE" ] || . "$VU_STATE"
__vu_k=0 __vu_at= __vu_was=
# bash 3.2 runs a DEBUG trap for the ERR trap itself, so the failing command is where the DEBUG trap before that one
# stood. journeys.mjs joins a failure's records through function returns and drops it when a record R follows it.
__vu_err() {
  [ "$BASH_SUBSHELL" = 0 ] || return 0
  printf 'F\t%s\t%s\t%s\t%s\t%s\n' "$__vu_k" "$1" "$__vu_was" "$(wc -c <"$VU_LOG")" "${2//$'\n'/ }" >>"$VU_FAILS"
}
__vu_dbg() {
  [ "$BASH_SUBSHELL" = 0 ] || return 0
  case ${FUNCNAME[1]-} in __vu_*) return 0 ;; esac
  __vu_k=$((__vu_k + 1)) __vu_was=$__vu_at __vu_at=$2:$1
  case $3 in *'$?'*) printf 'R\t%s\n' "$__vu_k" >>"$VU_FAILS" ;; esac
  printf '%s\n' "$__vu_at" >"$VU_CUR"
}
# The driver's last command: the variables and functions this journey added, for the journeys after it.
__vu_save() {
  trap - ERR DEBUG
  {
    for __vu_n in $(compgen -v); do
      case "$__vu_env" in *" $__vu_n "*) continue ;; esac
      case $__vu_n in __vu_* | BASH* | FUNCNAME | PIPESTATUS | _) continue ;; esac
      __vu_d=$(declare -p "$__vu_n" 2>/dev/null) || continue
      __vu_f=${__vu_d#declare -}
      case ${__vu_f%% *} in *r*) continue ;; esac
      printf '%s\n' "$__vu_d"
    done
    for __vu_n in $(compgen -A function); do
      case $__vu_n in __vu_*) ;; *) declare -f "$__vu_n" ;; esac
    done
  } >"$VU_STATE.tmp" && mv -f "$VU_STATE.tmp" "$VU_STATE"
}
set -E -T
trap '__vu_err $? "$BASH_COMMAND"' ERR
trap '__vu_dbg "$LINENO" "${BASH_SOURCE[0]}" "$BASH_COMMAND"' DEBUG
