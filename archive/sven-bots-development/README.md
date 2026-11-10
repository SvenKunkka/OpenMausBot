# Sven Bots 本地开发辅助源码

此目录保留安装、公开源码导出、审计、集成配置和隔离测试期间编写的辅助脚本。脚本快照依赖当时的应用包、工具或相邻项目路径。正式开发与验证入口见[仓库验证文档](../../docs/verification/README.md)。

- 根目录保存安装、开源导出、审计和各版本本地验证脚本。
- sven-bots-integrations 保存 GitHub 只读、平台消息、微信与 QQ 绑定辅助脚本以及依赖清单。飞书配置和夹具从环境变量 SVEN_BOTS_FEISHU_PROFILE 和 SVEN_BOTS_FEISHU_TEST_CHAT 读取实例与测试会话。
- compare-vitest.py 按测试路径和完整用例名对照基线与候选版的完整 Vitest JSON。
- [任务收件箱归档](../../docs/verification/task-inbox/README.md)包含产品规划、验证进度与截图。

第三方组件从各自的上游依赖取得。原机数据、凭证、绑定二维码、测试数据副本、原始日志和构建产物保留在本地归档。
