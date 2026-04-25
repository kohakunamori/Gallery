# upload_r2.py boto3 迁移设计

## 目标
将 `upload_r2.py` 中 Cloudflare R2 的上传与对象列举逻辑从手写 SigV4 + `urllib` 迁移到 `boto3`/`botocore`，提升连接稳定性并复用 SDK 的重试能力，同时保持现有命令行参数、环境变量和 Linux 上传行为不变。

## 范围
- 替换 R2 相关的 GET/PUT 实现。
- 保留当前 CLI 接口、返回消息格式和 Linux 上传逻辑。
- 新增 `requirements.txt`，显式声明 `boto3` 依赖。

不在本次范围内：
- 改动 Linux 上传实现。
- 调整上传目录扫描、文件过滤或对象 key 规则。
- 增加新的 CLI 参数或改变默认行为。

## 方案选择
采用“R2 全量迁移到 boto3，Linux 分支不动”的方案。

原因：
1. 当前 `list_existing_keys()` 和 `upload_to_r2()` 都出现过传输层失败，只替换 PUT 不够彻底。
2. `boto3` 可直接对接 Cloudflare R2 的 S3 兼容接口，减少手写签名和底层 HTTP 细节。
3. 保持函数输入输出接口稳定，可将改动限制在 R2 分支内部。

## 设计

### 1. R2 client 工厂
新增一个轻量 `make_r2_client(...)`，统一创建 boto3 S3 client，配置：
- `endpoint_url=<R2 endpoint>`
- `region_name='auto'`
- `aws_access_key_id` / `aws_secret_access_key`
- `signature_version='s3v4'`
- `retries={'mode': 'standard', 'max_attempts': 10}`

这样 `list_existing_keys()` 和 `upload_to_r2()` 共用同一套配置，避免分散实现。

### 2. 列举现有对象
`list_existing_keys()` 改为调用 boto3 的 `list_objects_v2` paginator 或等价分页循环：
- 按原逻辑保留 prefix 处理方式。
- 收集所有 `Contents[].Key`。
- 成功时继续返回 `(existing_keys, None)`。
- 失败时捕获异常并返回 `(partial_keys_or_empty_set, error_message)`，保持当前调用方接口不变。

### 3. 上传对象
`upload_to_r2()` 改为 boto3 上传：
- 继续读取本地文件内容并推断 `ContentType`。
- 调用 `put_object` 上传到目标 bucket/key。
- 保持 dry-run / skip-existing 判断顺序不变。
- 成功与失败消息保持现有格式，避免影响上层统计逻辑。

### 4. 删除旧实现
移除只服务于手写 SigV4/urllib 的 R2 辅助函数和相关导入，减少维护负担。

### 5. 依赖管理
新增 `requirements.txt`：
- `boto3`

脚本不做“可选依赖”兼容处理，因为已确认本次方案就是直接引入 boto3 依赖。

## 数据流
1. `main()` 解析参数与环境变量。
2. 若启用 R2 且需要跳过已存在对象，则调用 boto3 版 `list_existing_keys()`。
3. 对每个文件调用 `upload_to_r2()`，由 boto3 执行上传。
4. 上层继续沿用现有状态统计与消息打印逻辑。

## 错误处理
- 依赖 SDK 自带重试处理瞬时网络故障。
- SDK 最终失败后，仍在函数边界转换为当前脚本使用的 `(status, message)` 返回格式。
- 不新增额外 fallback，避免复杂化。

## 测试策略
1. 先补一个最小回归测试，覆盖 R2 client 调用路径或关键函数行为。
2. 验证测试先失败，再实现迁移。
3. 实现后运行最小上传验证，优先验证：
   - `list_existing_keys()` 能正常列举。
   - 单文件 R2 上传成功或至少不再表现为原始 `urllib` 传输层错误。

## 风险
- 本地尚未安装 `boto3`，需要先安装依赖。
- 如果运行环境网络本身异常，SDK retry 只能降低失败率，不能保证 100% 成功。
- 当前目录没有现成测试框架，可能需要补最小 Python 测试文件或临时验证脚本。

## 成功标准
- `upload_r2.py` 不再使用 `urllib` 执行 R2 上传或对象列举。
- R2 相关逻辑改为 boto3。
- Linux 分支行为不变。
- 新增依赖声明文件。
- 至少完成一次最小 R2 路径验证。