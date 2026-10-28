#!/usr/bin/env bash
# 作業終了時（Stop）に lint・型チェック・テストを実行する。
# 失敗したら終了コード 2 で停止を止め、失敗したコマンドと出力の末尾だけを返す。
# 成功時は何も出力しない（会話を検証ログで埋めないため）。
set -u

input=$(cat)
# 同じ停止で2回目に呼ばれたときは無限ループを避けて通す
if printf '%s' "$input" | grep -q '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# コード変更がなければ何もしない
if git rev-parse --git-dir >/dev/null 2>&1; then
  # 未コミットのファイルと、未プッシュのコミットで変わったファイルを集める
  # （upstream が無いブランチは、既定ブランチとの差分を見る）
  base=$(git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo origin/HEAD)
  changed=$( { git status --porcelain 2>/dev/null | cut -c4-
               git diff --name-only "$base...HEAD" 2>/dev/null; } | sort -u)
  # Markdown と docs/ だけの変更なら検証しない
  code_changed=$(printf '%s\n' "$changed" | grep -v -e '^$' -e '\.md$' -e '^docs/' || true)
  # 比較先のブランチが分からないときは、安全側に倒して検証する
  if git rev-parse -q --verify "$base" >/dev/null; then
    [ -n "$code_changed" ] || exit 0
  fi
fi

[ -f package.json ] || exit 0
command -v npm >/dev/null 2>&1 || exit 0

has_script() {
  # npm init 既定の test（"no test specified"）は無いものとして扱う
  node -e "const s=require('./package.json').scripts?.['$1'];process.exit(s && !/no test specified/.test(s) ? 0 : 1)" 2>/dev/null
}

failed=0
report=""
for script in lint typecheck test; do
  has_script "$script" || continue
  if ! out=$(npm run --silent "$script" 2>&1); then
    failed=1
    report+=$'\n'"### npm run $script が失敗"$'\n'"$(printf '%s\n' "$out" | tail -n 30)"$'\n'
  fi
done

if [ "$failed" -ne 0 ]; then
  printf '検証に失敗しました。直してから完了してください。%s' "$report" >&2
  exit 2
fi
exit 0
