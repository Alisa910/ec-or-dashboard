# EC OR Dashboard — GitHub → Vercel 部署指南

## 前置要求

1. **GitHub Desktop**（[下载](https://desktop.github.com/)）或 **Git**（[下载 Git for Windows](https://git-scm.com/download/win)）
2. **GitHub 账号**
3. **Vercel 账号**（可用 GitHub 登录）

---

## 一、将代码推送到 GitHub

### 方式 A：使用 GitHub Desktop（推荐）

1. **安装 GitHub Desktop** 并登录你的 GitHub 账号

2. **添加本地仓库**：在 GitHub Desktop 中点击 **File** → **Add local repository**，选择 `ec-or-dashboard` 文件夹
   - 若提示「未初始化 Git」，在弹窗中点击 **create a repository** 以在该目录初始化

3. **创建 GitHub 仓库**：
   - 在 GitHub Desktop 中点击 **Publish repository**
   - 仓库名：`ec-or-dashboard`（或任意名称）
   - 勾选 **Public**，取消勾选「Keep this code private」
   - 点击 **Publish repository**

4. **提交并推送**：之后每次修改代码后，在 GitHub Desktop 中点击 **Commit to main**、**Push origin** 即可

### 方式 B：使用命令行

1. **初始化 Git 并提交**（在项目目录 `ec-or-dashboard` 下执行）：

```bash
cd ec-or-dashboard

git init
git add .
git commit -m "Initial commit: EC OR Dashboard"
```

2. **在 GitHub 创建仓库**：打开 [github.com/new](https://github.com/new)，仓库名 `ec-or-dashboard`，选择 **Public**，不勾选 README

3. **关联远程并推送**（将 `YOUR_USERNAME` 替换为你的 GitHub 用户名）：

```bash
git remote add origin https://github.com/YOUR_USERNAME/ec-or-dashboard.git
git branch -M main
git push -u origin main
```

---

## 二、在 Vercel 部署

### 1. 导入项目

1. 打开 [vercel.com](https://vercel.com) 并登录（建议用 GitHub）
2. 点击 **Add New…** → **Project**
3. 在 **Import Git Repository** 中找到 `ec-or-dashboard`，点击 **Import**

### 2. 配置项目

- **Root Directory**：保持默认（或填 `ec-or-dashboard`，若仓库根目录不是项目根）
- **Framework Preset**：Other
- **Build Command**：留空或 `npm run build`
- **Output Directory**：留空（由 `vercel.json` 控制）

### 3. 配置环境变量（LIVE 数据必填）

在 **Environment Variables** 中添加以下变量（与 `api/sales.js` 中一致）：

| 变量名 | 说明 |
|--------|------|
| `SNOWFLAKE_ACCOUNT` | Snowflake 账号标识 |
| `SNOWFLAKE_USER` | 用户名 |
| `SNOWFLAKE_PASSWORD` | 密码 |
| `SNOWFLAKE_WAREHOUSE` | 仓库名 |
| `SNOWFLAKE_DATABASE` | 数据库（如 FNF） |
| `SNOWFLAKE_ROLE` | 角色 |

勾选 **Production / Preview / Development** 后保存。

**⚠ 重要**：未配置或配置错误时，Dashboard 会自动降级为 **DEMO 模式**，显示演示数据并带警示条。配置正确后，页面会显示 **LIVE 数据**。

### 4. 部署

点击 **Deploy**，等待构建完成。

---

## 三、部署后验证

- 首页：`https://你的项目名.vercel.app/`
- API：`https://你的项目名.vercel.app/api/sales?year=2026`

**数据模式说明**：
- **LIVE**：显示绿色 badge，数据来自 Snowflake 实时查询
- **DEMO**：显示黄色 badge 和顶部警示条，数据为演示数据（无法连接 Snowflake 时自动降级）

---

## 四、后续更新

代码推送到 GitHub 后，Vercel 会自动重新部署：

```bash
git add .
git commit -m "更新说明"
git push
```

---

## 常见问题

### Git 未安装或无法识别

安装 [Git for Windows](https://git-scm.com/download/win)，安装时勾选 “Add Git to PATH”。

### 推送时要求登录

- 使用 HTTPS：按提示输入 GitHub 用户名和 Personal Access Token
- 或使用 [GitHub Desktop](https://desktop.github.com/) 图形界面推送

### Vercel 构建失败

检查环境变量是否全部配置，且 `api/sales.js` 中使用的变量名与 Vercel 中一致。
