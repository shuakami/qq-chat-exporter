#!/bin/bash
set -e

CONFIG_DIR="/app/napcat/config"
mkdir -p "$CONFIG_DIR"

# plugins.json — 确保 QCE 启用
if [ ! -f "$CONFIG_DIR/plugins.json" ]; then
    cat > "$CONFIG_DIR/plugins.json" << 'EOF'
{
  "napcat-plugin-builtin": true,
  "napcat-plugin-qce": true
}
EOF
elif ! grep -q '"napcat-plugin-qce"' "$CONFIG_DIR/plugins.json"; then
    # plugins.json 存在但缺少 napcat-plugin-qce，用 sed 注入
    sed -i 's/}/  ,"napcat-plugin-qce": true\n}/' "$CONFIG_DIR/plugins.json"
fi

# napcat.json（仅不存在时创建）
if [ ! -f "$CONFIG_DIR/napcat.json" ]; then
    cat > "$CONFIG_DIR/napcat.json" << 'EOF'
{
  "fileLog": false,
  "consoleLog": true,
  "fileLogLevel": "debug",
  "consoleLogLevel": "info",
  "packetBackend": "auto",
  "packetServer": "",
  "o3HookMode": 1
}
EOF
fi

# onebot11.json（仅不存在时创建）
if [ ! -f "$CONFIG_DIR/onebot11.json" ]; then
    cat > "$CONFIG_DIR/onebot11.json" << 'EOF'
{
  "network": {
    "httpServers": [],
    "httpSseServers": [],
    "httpClients": [],
    "websocketServers": [],
    "websocketClients": []
  },
  "musicSignUrl": "",
  "enableLocalFile2Url": true,
  "parseMultMsg": false,
  "debug": false,
  "heartInterval": 30000,
  "messagePostFormat": "array",
  "reportSelfMessage": false,
  "token": ""
}
EOF
fi

# 委托给基础镜像的 entrypoint.sh
exec bash /app/entrypoint.sh "$@"
