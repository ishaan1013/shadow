# Shadow（[案例研究](https://www.ishaand.com/shadow)）

<img width="2880" height="1620" alt="cover" src="https://github.com/user-attachments/assets/69dfd5f8-0532-4515-a59e-9d43f2243ad8" />

一个开源的后台编码代理。设计用于理解、推理和贡献现有代码库。基于 MIT 许可证开源。

为 AI 代理设置隔离的执行环境，使其能够处理 GitHub 仓库，提供代码理解、文件编辑等多种工具。

### 代理环境（The Shadow Realm）
- GitHub 仓库集成与分支管理
- 自动生成包含 AI 提交的 Pull Request
- 实时任务状态跟踪与进度更新
- 在 Micro-VM 上自动设置和清理工作区
- Kata QEMU 容器实现硬件级隔离

### 代码生成与理解
- 多 LLM 提供商支持（Anthropic、OpenAI、OpenRouter）
- 流式聊天界面与实时响应
- 工具执行：文件操作、终端命令和代码搜索
- 仓库特定知识的记忆系统
- 语义代码搜索、后台处理
- 轻量级 Shadow Wiki 生成，提供全面的代码库文档
- 自定义 Shadow 代码生成规则

## 执行模式

Shadow 通过抽象层支持两种执行模式：

### 本地模式
- 在主机上直接执行文件系统操作

### 远程模式（用于部署）
- 在 Kata QEMU 容器中进行硬件隔离执行
- 通过 QEMU 虚拟化实现真正的 VM 隔离
- Kubernetes 编排与裸金属节点

模式选择通过 `NODE_ENV` 和 `AGENT_MODE` 环境变量控制。

## 开发环境设置

### 仓库结构

- **前端**（`apps/frontend/`）- Next.js 应用，包含实时聊天界面、终端模拟器、文件浏览器和任务管理
- **服务器**（`apps/server/`）- Node.js 编排器，处理 LLM 集成、WebSocket 通信、任务初始化和 API 端点
- **边车**（`apps/sidecar/`）- Express.js 服务，提供隔离容器内文件操作的 REST API
- **网站**（`apps/website/`）- 营销和着陆页
- **数据库**（`packages/db/`）- Prisma schema 和 PostgreSQL 客户端，包含全面的数据模型
- **类型**（`packages/types/`）- 整个平台的共享 TypeScript 类型定义
- **命令安全**（`packages/command-security/`）- 命令验证和清理的安全工具
- **ESLint 配置**（`packages/eslint-config/`）- 共享代码规范规则
- **TypeScript 配置**（`packages/typescript-config/`）- 共享 TypeScript 配置

### 前提条件
- Node.js 22
- PostgreSQL

### 安装

1. 克隆仓库并安装依赖：
```bash
git clone <repository-url>
cd shadow
npm install
```

2. 设置环境变量：
```bash
# 复制示例环境文件
cp apps/server/.env.template apps/server/.env
cp apps/frontend/.env.template apps/frontend/.env
cp packages/db/.env.template packages/db/.env
```

3. 配置数据库：
```bash
# 创建本地 PostgreSQL 数据库
psql -U postgres -c "CREATE DATABASE shadow_dev;"

# 更新 packages/db/.env 中的数据库 URL
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"

# 生成 Prisma 客户端并推送 schema
npm run generate
npm run db:push
```

4. 启动开发服务器：
```bash
# 启动所有服务
npm run dev

# 或启动特定服务
npm run dev --filter=frontend
npm run dev --filter=server
npm run dev --filter=sidecar
```

### 环境配置

在以下文件中设置变量：
- 前端：`apps/frontend/.env.local`
- 服务器：`apps/server/.env`
- 数据库：`packages/db/.env`

#### 快速开始（本地，无需安装 GitHub App）
使用个人 GitHub 令牌，可以立即使用 GitHub 选择器，无需安装应用。

1) 创建具有以下权限的 GitHub 个人访问令牌：`repo`、`read:org`。
2) 添加环境变量：

最简单的方式是运行 `./setup-script.sh`，它会接收你的输入变量并自动设置到正确的位置！如果想手动操作，请按以下说明进行：

`apps/server/.env`
```bash
# 必填
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
BETTER_AUTH_SECRET="dev-secret"

GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx

# 本地模式
NODE_ENV=development
AGENT_MODE=local

# 可选：用于语义搜索的 Pinecone
PINECONE_API_KEY="" # TODO: 设置你的 Pinecone API 密钥
PINECONE_INDEX_NAME="shadow"

# 本地代理的工作区目录：
WORKSPACE_DIR= # TODO: 设置你的本地工作区目录
```

`apps/frontend/.env.local`
```bash
# 如果需要，将前端指向你的服务器
NEXT_PUBLIC_SERVER_URL=http://localhost:4000

# 标记环境；除 "production" 外的任何值启用本地行为
NEXT_PUBLIC_VERCEL_ENV=development

GITHUB_PERSONAL_ACCESS_TOKEN=ghp_xxx
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# 可选（仅在本地需要 OAuth 登录时）
BETTER_AUTH_SECRET=dev-secret
```

`packages/db/.env`
```bash
DATABASE_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
DIRECT_URL="postgres://postgres:@127.0.0.1:5432/shadow_dev"
```

在服务器上设置 `GITHUB_PERSONAL_ACCESS_TOKEN` 且 `NEXT_PUBLIC_VERCEL_ENV` 不等于 `production` 时，后端会使用你的 PAT 进行仓库/分支/问题查询。前端的 GitHub 选择器可以立即工作。

## 开发命令

### 代码检查和格式化

```bash
# 检查所有包和应用
npm run lint

# 使用 Prettier 格式化代码
npm run format

# 类型检查
npm run check-types
```

### 数据库操作

```bash
# 从 schema 生成 Prisma 客户端
npm run generate

# 推送 schema 变更到数据库（开发用）
npm run db:push

# 重置数据库并推送 schema（破坏性操作）
npm run db:push:reset

# 打开 Prisma Studio GUI
npm run db:studio

# 在开发中运行迁移
npm run db:migrate:dev
```

### 构建和部署

```bash
# 构建所有包和应用
npm run build

# 构建特定应用
npm run build --filter=frontend
npm run build --filter=server
npm run build --filter=sidecar
```

## 工具系统

Shadow 为 AI 代理提供了一套全面的工具：

### 文件操作
- `read_file` - 读取文件内容，支持行范围
- `edit_file` - 写入和修改文件
- `search_replace` - 精确字符串替换
- `delete_file` - 安全文件删除
- `list_dir` - 目录浏览

### 代码搜索
- `grep_search` - 正则表达式模式匹配
- `file_search` - 模糊文件名搜索
- `semantic_search` - AI 驱动的语义代码搜索

### 终端和执行
- `run_terminal_cmd` - 带实时输出的命令执行
- 命令验证和安全检查

### 任务管理
- `todo_write` - 结构化任务管理
- `add_memory` - 仓库特定知识存储
- `list_memories` - 检索存储的知识

## 开发指南

### 代码组织
- 全程使用 TypeScript，严格类型检查
- 通过包共享配置
- 执行模式之间的清晰分离
- 前后端 WebSocket 事件兼容性

### 安全
- 所有执行模式下的命令验证
- 路径遍历保护
- 工作区边界强制执行
- 远程模式下的容器隔离

### 重要注意事项
- 始终为生产功能测试本地和远程两种模式
- 保持初始化步骤的模式感知和适当抽象
- 维护前后端变更的 WebSocket 事件兼容性
- **远程模式需要 Amazon Linux 2023 节点**以兼容 Kata Containers

## 贡献

1. Fork 仓库
2. 创建功能分支
3. 使用正确的 TypeScript 类型进行修改
4. 在本地和远程两种模式下测试
5. 提交 Pull Request

我们很高兴看到你用 Shadow 构建的东西！

---

[Ishaan Dey](https://ishaand.com) — [X](https://x.com/ishaandey_)

[Rajan Agarwal](https://www.rajan.sh/) — [X](https://x.com/_rajanagarwal)

[Elijah Kurien](https://www.elijahkurien.com/) — [X](https://x.com/ElijahKurien)
