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
