#!/usr/bin/env bash
# 拉取 DustinWin/geoip 的 Loon IP 规则集，给每行补上 no-resolve 后写入 rule/noresolve/。
#
# 用途：Loon 订阅行没有规则集级别的 no-resolve 开关，上游文件每行又不带该标记，
#       域名未命中域名规则时会为了匹配这些 IP 规则先做本地 DNS 解析（DNS 泄露）。
# 用法：在仓库根目录执行 bash .github/scripts/sync-ip-rules.sh
# 契约：任一文件下载失败、出现非 IP-CIDR/IP-CIDR6 行、或行数低于下限时非零退出，
#       且不改动 rule/noresolve/ 下已有文件（全部校验通过后才整体替换）。
set -euo pipefail

SRC_BASE="https://github.com/DustinWin/geoip/releases/download/ips"
OUT_DIR="rule/noresolve"
# 名称:最少行数。低于下限视为上游异常（截断、空文件），拒绝覆盖。
LISTS="privateip:20 cnip:5000 mediaip:300 telegramip:8"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

for item in $LISTS; do
  name=${item%%:*}
  min=${item##*:}
  curl -fsSL --retry 3 --max-time 120 -o "$tmp/$name.src" "$SRC_BASE/$name.list"
  awk -F, -v min="$min" -v name="$name" '
    ($1 != "IP-CIDR" && $1 != "IP-CIDR6") \
      || $2 !~ /^[0-9a-fA-F:.]+\/[0-9]+$/ \
      || !(NF == 2 || (NF == 3 && $3 == "no-resolve")) {
      printf "%s: 第 %d 行格式不符合预期: %s\n", name, NR, $0 > "/dev/stderr"
      bad = 1
      exit 1
    }
    { print $1 "," $2 ",no-resolve"; n++ }
    END {
      if (bad) exit 1
      if (n < min) {
        printf "%s: 仅 %d 行，低于下限 %d\n", name, n, min > "/dev/stderr"
        exit 1
      }
    }
  ' "$tmp/$name.src" > "$tmp/$name.list"
done

mkdir -p "$OUT_DIR"
for item in $LISTS; do
  name=${item%%:*}
  mv "$tmp/$name.list" "$OUT_DIR/$name.list"
done
