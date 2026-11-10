# Sven Bots 任务收件箱开发进度

2026-11-10 · 基线 25b4cdf · 候选 0.1.151-workbench.6

用户在同一聊天连续提交任务时，每次发送都会产生独立记录。收件箱显示排队、执行和等待状态，任务完成后能打开对应回复，并保留其他结果的未看标记。发送菜单提供「补充当前任务」。

- [功能规划](plan.md)
- [施工清单与验收进度](todo.md)
- [桌面任务进行中](desktop-active.png)、[桌面定位原结果](desktop-result.png)、[窄屏结果未看](mobile-unread.png)
- [Electron 基线与候选失败项对照](electron-suite-diff.json)
- [本地辅助源码与开发夹具](../../../archive/sven-bots-development/README.md)

开发归档时复跑 6 个相关测试文件，43 项通过。此前已验证桌面与窄屏流程、历史消息定位、中断恢复、旧数据兼容、候选构建和隔离回退。两套全量 Vitest 都中途终止，待从基线和候选分别重跑并比较。候选版未正式安装。

复跑本次归档验证

~~~sh
pnpm exec vitest run server/chat-followups-restart.test.ts server/chat-followups.test.ts server/place-inbox.e2e.test.ts src/components/inbox/InboxPanel.dom.test.ts src/state/inbox-tasks.test.ts src/lib/focus-message.test.ts
~~~
