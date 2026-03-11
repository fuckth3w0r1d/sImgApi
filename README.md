# sImgApi

本地图片爬取、入库、代理的轻量 API 服务，基于 [Hono](https://hono.dev/) + Node.js。

## 功能

- 通过配置文件批量爬取图库页面，自动入库并缓存图片
- 支持按 tag 分组管理图片集
- 随机返回图片（先随机 tag，再随机 set）
- 代理访问图片，本地缓存，减少重复请求
- 支持手动爬取入库（单页面或直接传 URL 列表）

## 快速开始

```bash
npm install
cp .env.example .env
cp config/seed.example.json config/seed.json
# 编辑 config/seed.json，填入你的图库 URL
npm run dev
```

生产环境：

```bash
npm run build
npm start
```

## 配置

### `.env`

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `./data` | 元数据存储目录 |
| `CACHE_DIR` | `./cache` | 图片缓存目录 |
| `SEED_CONFIG` | `./config/seed.json` | 种子图库配置文件路径 |
| `SEED_CONCURRENCY` | `5` | 并发下载数 |
| `FETCH_TIMEOUT_MS` | `15000` | 单次 fetch 超时（毫秒） |

### `config/seed.json`

启动时自动爬取的图库列表，参考 `config/seed.example.json`：

```json
[
  {
    "tag": "二次元",
    "urls": [
      "https://example.com/gallery1",
      "https://example.com/gallery2"
    ]
  },
  {
    "tag": "写真",
    "urls": [
      "https://example.com/gallery3"
    ]
  }
]
```

每个条目的 `tag` 可选。无 tag 的图片归入 `__untagged__` 分组。

## API 文档

Base URL: `http://localhost:3000`

### 健康检查

```
GET /health
```

响应：`{ "status": "ok" }`

---

### 图片管理

#### `GET /images`

分页列出所有图片。

| Query | 默认 | 说明 |
|-------|------|------|
| `page` | 1 | 页码 |
| `limit` | 20 | 每页数量，最大 100 |
| `mime` | - | 按 MIME 类型过滤 |
| `setId` | - | 按 set 过滤 |

#### `GET /images/sets`

分页列出所有图片集（每个 set 含封面 ID、图片数、来源 URL）。

| Query | 默认 | 说明 |
|-------|------|------|
| `page` | 1 | 页码 |
| `limit` | 20 | 每页数量，最大 100 |

#### `GET /images/random`

随机返回 3 张图片。无 `tag` 参数时先随机一个 tag，再随机其下一个 set。

| Query | 说明 |
|-------|------|
| `tag` | 指定 tag（可选） |

响应：
```json
{
  "data": [ ...ImageMeta ],
  "setId": "abc123",
  "tag": "二次元"
}
```

#### `POST /images/seed/refresh`

触发重新爬取 seed 图库（后台异步执行）。

| Query | 说明 |
|-------|------|
| `tag` | 只刷新指定 tag（可选） |

响应：`{ "message": "Refresh started", "queued": 3, "tag": "二次元" }`

#### `DELETE /images/:id`

删除指定图片。

#### `DELETE /images/sets/:setId`

删除整个 set 及其所有图片。

---

### 爬取入库

#### `POST /search-crawl`

爬取图库页面或批量入库图片 URL。

**方式一：爬取页面**
```json
{
  "galleryUrl": "https://example.com/gallery",
  "count": 50
}
```

**方式二：直接传 URL 列表**
```json
{
  "urls": ["https://example.com/1.jpg", "https://example.com/2.jpg"],
  "sourceUrl": "https://example.com"
}
```

| 字段 | 说明 |
|------|------|
| `count` | 最多入库数量，默认 50，最大 200 |
| `sourceUrl` | urls 模式下的来源地址，默认 `"direct"` |

响应：
```json
{
  "saved": [ ...ImageMeta ],
  "skipped": [ { "url": "...", "reason": "Already indexed" } ],
  "requested": 50
}
```

---

### 图片代理

#### `GET /proxy/:id`

通过图片 ID 代理返回图片内容。优先命中本地缓存，未缓存时从原始 URL 下载并写入缓存。

响应为图片二进制流，携带对应 `Content-Type` 和 `Cache-Control: public, max-age=86400`。

---

## 数据结构

### ImageMeta

```ts
{
  id: string          // nanoid
  url: string         // 原始图片 URL
  sourceUrl: string   // 来源页面 URL
  mime: string        // 如 "image/jpeg"
  width: number
  height: number
  uploadedAt: string  // ISO 8601
  setId: string       // 同一图库页面的图片共享同一 setId
  picIndex: number    // set 内序号
  tag?: string        // 分组标签
}
```

### 支持的图片格式

`image/jpeg` · `image/png` · `image/gif` · `image/webp` · `image/avif`

## 项目结构

```
src/
  index.ts              # 入口，路由注册
  types.ts              # 类型定义
  routes/
    images.ts           # /images 路由
    proxy.ts            # /proxy 路由
    search-crawl.ts     # /search-crawl 路由
  lib/
    crawler.ts          # 页面爬取 & 图片下载
    seed.ts             # 启动种子 & 刷新逻辑
    storage.ts          # 内存存储 & 持久化
    validate.ts         # MIME 校验
config/
  seed.example.json     # 种子配置示例
data/                   # 元数据（metadata.json）
cache/                  # 图片缓存文件
```
