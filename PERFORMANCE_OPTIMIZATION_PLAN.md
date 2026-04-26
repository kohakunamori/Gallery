# Gallery 多图站点性能优化计划

## 背景与目标

当前 Gallery 项目的运行链路是：

```text
本地图片目录
  -> script/upload_r2.py
  -> R2 / Linux / 七牛
  -> backend 扫描 storage/photos 生成 /api/photos
  -> frontend React 瀑布流展示
  -> static.cf.nyaneko.cn / CDN 传输图片
```

项目主要性能瓶颈仍然是：瀑布流列表页会较早加载过多图片，且长列表滚动后图片节点与解码缓存长期堆积，导致首屏、滚动流畅度和内存表现都不够理想。

本轮优化目标改为：

- 保留当前单一图片资源结构，不引入 variants / manifest 流程。
- 保留原图质量，详情页继续使用原图。
- 优先优化首屏调度、优先级、解码和长列表运行时成本。
- 利用现有 CDN 长缓存和后端短缓存，先把明显的加载与渲染浪费压下去。
- 在不重做数据结构的前提下，为后续进一步图片传输优化保留空间。

---

## 当前关键事实

### 上传脚本

文件：`script/upload_r2.py`

已有能力：

- 默认 `avif-lossless` 压缩模式。
- ImageMagick AVIF lossless 转换。
- oxipng PNG 优化。
- R2 / Linux / 七牛多目标上传。
- `.upload_target_cache.json` 上传缓存。
- `.upload_prepared_cache` 准备文件缓存。
- R2 上传时设置：

```http
Cache-Control: public, max-age=315360000, immutable
```

当前结论：

- 上传脚本继续负责原图发布即可。
- 暂不增加 variants 生成、manifest 输出或额外发布产物。

### 后端

文件：`backend/src/Service/PhotoIndexService.php`

当前行为：

```php
'url' => $url,
'thumbnailUrl' => $url,
```

当前结论：

- 暂时保持单图源数据结构。
- 优先通过 HTTP 缓存和前端调度降低整体成本。

文件：`backend/src/Action/GetPhotosAction.php`

当前 `/api/photos` 已返回 JSON，并增加了短缓存：

```http
Cache-Control: public, max-age=15, stale-while-revalidate=60
ETag: "<hash>"
```

支持 `If-None-Match` 返回 304。

文件：`backend/src/createApp.php`

本地 `/media` 已有强缓存、ETag、Last-Modified、Content-Length，且补上了在缺少 `fileinfo` 扩展时的 MIME fallback。

### 前端

文件：`frontend/src/components/exhibition/WaterfallCard.tsx`

当前图片：

```tsx
<img
  src={imageUrl}
  loading={isPriority ? 'eager' : 'lazy'}
  fetchPriority={isPriority ? 'high' : 'auto'}
  width={photo.width ?? undefined}
  height={photo.height ?? undefined}
  decoding="async"
/>
```

已完成：

- `width`
- `height`
- `decoding="async"`
- 首屏 priority 图高优先级
- 去掉 filter transition

仍可继续优化：

- 远离视口图片卸载
- auto 列数策略
- visibleCount / loadMoreCount 与列数联动
- resize 更新频率
- observer / state 更新批量化

文件：`frontend/src/components/exhibition/WaterfallGallery.tsx`

当前 auto 列数仍是固定断点式逻辑，且首批可见数量固定为 24。

文件：`frontend/src/components/viewer/PhotoViewerModal.tsx`

当前 modal 已提升当前图优先级，并将相邻图预加载延后到当前图加载之后。

---

## 最终目标架构

```text
本地图片目录
  -> upload_r2.py
      -> 上传原图到 gallery/
  -> backend
      -> 扫描 storage/photos
      -> /api/photos 返回原图信息
  -> frontend
      -> 瀑布流按列数和可见区调度图片挂载
      -> modal 加载原图
  -> CDN
      -> gallery/* 长缓存
```

---

## 阶段 1：低风险前端和传输优化

目标：不改变数据结构，先降低明显渲染和加载成本。

### 1.1 图片属性补全

文件：`frontend/src/components/exhibition/WaterfallCard.tsx`

给 `<img>` 增加：

```tsx
width={photo.width ?? undefined}
height={photo.height ?? undefined}
decoding="async"
```

### 1.2 调整 fetch priority

只给 1-3 张 LCP/首屏关键图 `fetchPriority="high"`。

### 1.3 去掉 filter transition

文件：`frontend/src/components/exhibition/WaterfallCard.tsx`

只保留 `opacity, transform`，避免大量图片同时触发 filter 绘制成本。

### 1.4 Modal 当前图优先

文件：`frontend/src/components/viewer/PhotoViewerModal.tsx`

当前图：

```tsx
decoding="async"
fetchPriority="high"
width={photo.width ?? undefined}
height={photo.height ?? undefined}
```

前后图预加载延后到当前图加载后，避免抢带宽。

### 1.5 LoadTrigger 节流

文件：`frontend/src/components/exhibition/LoadTrigger.tsx`

resetKey 变化且 trigger 仍 intersecting 时增加最小触发间隔，避免瞬时挂载多批图片。

### 1.6 `/api/photos` HTTP 缓存

文件：`backend/src/Action/GetPhotosAction.php`

成功响应增加：

```http
Cache-Control: public, max-age=15, stale-while-revalidate=60
ETag: "<hash>"
```

---

## 阶段 2：瀑布流和长列表运行时优化

### 2.1 Auto 列数按最小列宽

文件：`frontend/src/components/exhibition/WaterfallGallery.tsx`

用最小卡片宽度决定 auto 列数，而不是固定断点：

```ts
const MIN_TILE_WIDTH = 220;
const MAX_AUTO_COLUMNS = 6;
```

### 2.2 visible count 与列数联动

当前：

```ts
INITIAL_VISIBLE_COUNT = 24
LOAD_MORE_COUNT = 24
```

改为按列数推导：

```text
initialVisibleCount = columnCount * 4 或 columnCount * 5
loadMoreCount = columnCount * 3
```

### 2.3 远离视口图片卸载

当前卡片进入根 margin 后会长期保持图片挂载。

建议：

```text
进入 1200px：挂载 img
离开 3000px：卸载 img
保留 aspect-ratio 容器
```

### 2.4 observer / state 更新优化

当前每张卡片独立进入时都会 setState。

建议：

- 共享 observer 或减少 observer 数量。
- seen 集合批量更新。
- `WaterfallCard` 保持轻量、避免不必要重渲染。

### 2.5 resize 优化

建议：

- auto 模式只在列数变化时更新。
- 固定列数模式尽量不随 viewport 每次 resize 重算。
- 更优先用容器宽度而不是全局 viewport 宽度。

---

## 阶段 3：CDN 和部署配置

### 3.1 Cloudflare / R2 cache rule

目标路径：

```text
static.cf.nyaneko.cn/gallery/*
```

规则：

```text
Cache Everything
Edge TTL: 1 year
Browser TTL: 1 year
Cache key includes full path and query string
HTTP/2 / HTTP/3 enabled
```

验收：

```http
cf-cache-status: HIT
```

### 3.2 Vite 静态资源缓存

生产环境配置：

```http
/assets/*: Cache-Control: public, max-age=31536000, immutable
/fonts/*: Cache-Control: public, max-age=31536000, immutable
index.html: Cache-Control: no-cache
```

---

## 验收指标

每个阶段都用 Chrome DevTools 检查。

### 图片指标

- 首屏图片总 bytes。
- 首屏请求数量。
- LCP 图是否 high priority。
- modal 当前图是否优先完成加载。

### 传输指标

- 图片协议是否 h2/h3。
- `cf-cache-status` 是否 HIT。
- `/api/photos` 是否返回 304。
- JS/CSS/fonts 是否 immutable cache。

### 体验指标

- LCP。
- CLS。
- INP。
- 滚动流畅度。
- 长时间滚动后内存是否持续上涨。

---

## 推荐执行顺序

1. 前端低风险属性补全：`width` / `height` / `decoding` / 去 filter transition。
2. `/api/photos` 加 HTTP 缓存。
3. 检查并修 Cloudflare 图片 HIT。
4. 调整 auto 列数策略。
5. 让 visibleCount / loadMoreCount 与列数联动。
6. 加远离视口卸载。
7. 做 observer / resize 优化。
8. 用 DevTools 复测 LCP、滚动和内存。

---

## 一句话结论

不再走 variants / manifest 路线。当前最合理的路径是保留现有单图源发布结构，继续围绕瀑布流的加载优先级、列数策略、批量加载节奏、远离视口卸载和 CDN/HTTP 缓存做性能优化，先把首屏、滚动和内存问题压下来。
