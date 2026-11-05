#!/usr/bin/env bash

set -uo pipefail

# Fichiers/dossiers non suivis par git que l'on relie (lien symbolique) du
# worktree d'origine vers le nouveau worktree.
LINK_NAMES=("node_modules" "CLAUDE.md" ".env" "docs" "inputs-outputs" "compteurs_data" "documentation" ".claude" "GLOSSARY.md" "GLOSSARY-MAP.md" ".scratch")

usage() {
    cat <<'EOF'
USAGE:
    worktree.sh                          Liste les worktrees (branche et chemin)
    worktree.sh add <branch> [path]      Crée un worktree sur <branch> dans [path]
                                         (créée depuis master, ou main, si elle
                                         n'existe pas ; [path] par défaut :
                                         <repo>-<branche normalisée>, à côté du
                                         dépôt principal)
    worktree.sh remove|rm <branch|path> [-k|-d|-D]
                                         Supprime un worktree, puis la branche :
                                         -k  la garde
                                         -d  la supprime (refusé si non mergée)
                                         -D  la supprime même si non mergée
                                         sans option : demande (si terminal)
EOF
}

die() {
    echo "worktree.sh: $*" >&2
    exit 1
}

# --- Helpers ----------------------------------------------------------------

# Affiche une ligne "chemin<TAB>branche" par worktree.
wt_entries() {
    git worktree list --porcelain | awk '
        /^worktree / { if (path != "") print path "\t" branch; path = substr($0, 10); branch = "(detached)" }
        /^branch /   { branch = $2; sub("^refs/heads/", "", branch) }
        /^bare$/     { branch = "(bare)" }
        END          { if (path != "") print path "\t" branch }
    '
}

# Liste (en chemins absolus) les fichiers/dossiers portant un des LINK_NAMES.
# On ne descend pas dans .git ni dans une correspondance déjà trouvée.
find_candidates() {
    local root="$1" name
    local -a expr=()

    for name in "${LINK_NAMES[@]}"; do
        [ "${#expr[@]}" -gt 0 ] && expr+=(-o)
        expr+=(-name "$name")
    done

    find "$root" -mindepth 1 -maxdepth 4 \
        -name .git -prune -o \
        \( "${expr[@]}" \) -print -prune 2>/dev/null
}

# Vrai si le chemin (relatif à $root) n'est suivi par aucun commit.
is_untracked() {
    local root="$1" rel="$2"
    [ -z "$(git -C "$root" ls-files -- "$rel")" ]
}

# --- Commandes --------------------------------------------------------------

cmd_list() {
    local path branch width=0
    local -a paths=() branches=()

    while IFS=$'\t' read -r path branch; do
        paths+=("$path")
        branches+=("$branch")
        [ "${#branch}" -gt "$width" ] && width="${#branch}"
    done < <(wt_entries)

    local i
    for i in "${!paths[@]}"; do
        printf '%-*s  %s\n' "$width" "${branches[$i]}" "${paths[$i]}"
    done
}

# Crée les liens symboliques du worktree source vers le nouveau worktree.
link_extras() {
    local src="$1" dest="$2"
    local found rel target

    while IFS= read -r found; do
        rel="${found#"$src"/}"
        is_untracked "$src" "$rel" || continue

        # Si la source est elle-même un lien, on pointe vers la cible réelle.
        target=$(readlink -f "$found") || continue
        [ -n "$target" ] || continue

        if [ -e "$dest/$rel" ] || [ -L "$dest/$rel" ]; then
            continue
        fi

        mkdir -p "$(dirname "$dest/$rel")"
        ln -s "$target" "$dest/$rel" && echo "linked $rel -> $target"
    done < <(find_candidates "$src")
}

# Nom de branche utilisable dans un nom de dossier : tout caractère hors
# [A-Za-z0-9._-] devient '-', tirets consécutifs fusionnés, extrémités nettoyées.
normalize_branch() {
    printf '%s' "$1" | sed -E 's/[^A-Za-z0-9._-]+/-/g; s/-+/-/g; s/^-//; s/-$//'
}

# Chemin du worktree principal (le dépôt de base).
main_worktree() {
    wt_entries | head -n1 | cut -f1
}

cmd_add() {
    [ $# -eq 1 ] || [ $# -eq 2 ] || { usage; exit 1; }
    local branch="$1" path="${2:-}" src dest base_repo start=""

    git check-ref-format --branch "$branch" >/dev/null 2>&1 \
        || die "invalid branch name '$branch'"

    if ! git show-ref --verify --quiet "refs/heads/$branch"; then
        if git show-ref --verify --quiet refs/heads/master; then
            start=master
        elif git show-ref --verify --quiet refs/heads/main; then
            start=main
        else
            die "branch '$branch' does not exist and neither master nor main does"
        fi
    fi

    if [ -z "$path" ]; then
        base_repo=$(main_worktree)
        [ -n "$base_repo" ] || die "cannot find the main worktree"
        path="$(dirname "$base_repo")/$(basename "$base_repo")-$(normalize_branch "$branch")"
    fi

    if [ -e "$path" ] || [ -L "$path" ]; then
        die "path '$path' already exists"
    fi

    src=$(git rev-parse --show-toplevel) || exit 1

    mkdir -p "$(dirname "$path")" || exit 1
    if [ -n "$start" ]; then
        echo "creating branch '$branch' from '$start'"
        git worktree add -b "$branch" "$path" "$start" || exit 1
    else
        git worktree add "$path" "$branch" || exit 1
    fi

    dest=$(cd "$path" && pwd) || exit 1
    link_extras "$src" "$dest"
}

# Vrai si le chemin est un lien symbolique, ou un dossier ne contenant que des
# liens symboliques (donc entièrement créé par 'add').
only_links() {
    local path="$1"

    [ -L "$path" ] && return 0
    [ -d "$path" ] || return 1

    # find ne suit pas les liens : on ne descend donc pas dans node_modules & co.
    [ -z "$(find "$path" -mindepth 1 ! -type l ! -type d -print -quit)" ]
}

# Échoue si le worktree contient des modifications non commitées.
# Les liens symboliques créés par 'add' ne sont pas considérés comme des
# modifications.
check_clean() {
    local path="$1" line file dirty=""

    while IFS= read -r -d '' line; do
        file="${line:3}"
        if [ "${line:0:2}" = "??" ] && only_links "$path/${file%/}"; then
            continue
        fi
        dirty+="$line"$'\n'
    done < <(git -C "$path" status --porcelain -z)

    if [ -n "$dirty" ]; then
        echo "worktree.sh: '$path' has uncommitted changes:" >&2
        printf '%s' "$dirty" >&2
        exit 1
    fi
}

# Supprime les liens symboliques créés par 'add' (sans toucher à leur cible).
remove_links() {
    local path="$1" found

    while IFS= read -r found; do
        [ -L "$found" ] && rm -f "$found"
    done < <(find_candidates "$path")
}

cmd_remove() {
    # mode : ask (question si terminal), keep, delete (-d), force (-D).
    local target="" mode=ask abs path branch found="" arg
    for arg in "$@"; do
        case "$arg" in
            -k|--keep-branch)   mode=keep ;;
            -d|--delete-branch) mode=delete ;;
            -D|--force-delete-branch) mode=force ;;
            -*)                 usage; exit 1 ;;
            *)  [ -z "$target" ] || { usage; exit 1; }; target="$arg" ;;
        esac
    done
    [ -n "$target" ] || { usage; exit 1; }

    abs=$(readlink -f "$target" 2>/dev/null)

    while IFS=$'\t' read -r path branch; do
        if [ "$branch" = "$target" ] || [ "$path" = "$target" ] || { [ -n "$abs" ] && [ "$path" = "$abs" ]; }; then
            found="$path"
            break
        fi
    done < <(wt_entries)

    [ -n "$found" ] || die "no worktree matching '$target'"
    [ "$found" = "$(git rev-parse --show-toplevel)" ] \
        && die "refusing to remove the current worktree"

    check_clean "$found"
    remove_links "$found"

    git worktree remove "$found" || exit 1
    echo "removed $found"

    case "$branch" in
        "(detached)"|"(bare)") return 0 ;;
    esac

    case "$mode" in
        keep)   return 0 ;;
        delete) git branch -d "$branch" || exit 1; return 0 ;;
        force)  git branch -D "$branch" || exit 1; return 0 ;;
    esac

    [ -t 0 ] || return 0
    ask_yn "delete branch '$branch'?" || return 0
    git branch -d "$branch" && return 0
    ask_yn "branch '$branch' is not fully merged, force delete?" || return 0
    git branch -D "$branch" || exit 1
}

# Pose une question, attend 'y' ou 'n' (une seule touche, sans Entrée).
ask_yn() {
    local key
    while true; do
        read -r -n 1 -p "$1 [y/n] " key
        echo
        case "$key" in
            y|Y) return 0 ;;
            n|N) return 1 ;;
        esac
    done
}

# --- Entrée -----------------------------------------------------------------

git rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository"

case "${1:-}" in
    "")            cmd_list ;;
    add)           shift; cmd_add "$@" ;;
    remove|rm)     shift; cmd_remove "$@" ;;
    -h|--help|help) usage ;;
    *)             usage; exit 1 ;;
esac
