# POE2helper Updates

POE2helper 的公开赛季数据更新通道。这里不包含完整应用源代码。

## 更新内容

- POE2 简体中文、繁体中文与英文名称
- 技能、传奇、底材和天赋检索数据
- 官方交易词缀与装备词缀阶层
- 装备与技能图片索引
- 人工核对的玩家俗称和区域名称

## 安全策略

GitHub Actions 每日检查上游数据。新快照必须通过数量阈值、POE2 核心词条、英文主键、POE1 专属内容和人工补充数据检查，才会覆盖 `latest/`。App 下载时还会校验清单中的 SHA-256。

主要信源包括 GGG trade2、Path of Building POE2、PoeCharm2、RePoE POE2、POE2DB 和 POE2Scout。

## 自动维护范围

- 每天同步词典、交易词缀、装备词缀和图片索引。
- POE2DB 石板页只在每天 18:17 UTC 的固定任务窗口尝试一次；手动重跑复用已校验缓存，429/5xx 会退避重试，持续不可用时保留上次成功数据。
- 监视 POE2 Wiki 的 Acts quick guide 修订号；信源变化时自动创建 GitHub Issue。
- 发布带版本、大小和 SHA-256 的赛季数据及开荒路线清单。
- 新客户端在启动时以及每 6 小时检查数据、路线和程序版本。

## 需要人工核对的内容

`manual/poe2-campaign-guide.json` 是发给所有用户的稳定中文路线。信源变更只会创建提醒，不会把网页文字直接覆盖到客户端。核对任务、永久奖励和小技巧后，更新 `gameVersion`、`guideVersion`、`sourceRevision` 与 `releaseNotes`，再运行 `npm run build` 即可发布。

程序版本由 `manual/app-manifest.json` 和 GitHub Release 安装包组成。发布新版时需要填写版本、更新说明、安装包大小和 SHA-256；客户端会在打开安装包前完成校验。
