# 本地单次排班参考实现

本仓库协议对应的单次基建排班参考实现。使用 Node.js 24 标准库，无需安装依赖。

HTTP 已提供固定 ArkHost 换班消费链所需的 `data.arranged` 七类安排，并通过本地隔离 Go 合同验证；内部 `arrangePreview` 继续返回 `preview.arranged`。这不等于完整替代 ark-building-api、收益指标认证或真实账号换班验收。未定义的收益字段不填入 0 或空数组。

## 启动

检出本分支后，从仓库根目录运行：

```sh
git submodule update --init --depth 1
node scripts/check-data.mjs
node scripts/start.mjs --port 8787
```

数据默认从仓库内的 `data/ArknightsGamedataPure/` 只读加载。该标准 Git submodule 指向组织数据仓库，并固定到 `src/data/pin.mjs` 的 `dfc70c5a7aaebe5ca81790ac318e1fabe496ce0b`，不依赖数据仓库未合并的 PR 或开发机同级目录。初始化会下载该数据仓库，服务运行期间不下载或更新数据。

可用 `--data-dir <目录>` 指定已有数据副本；文件内容必须匹配版本锁中的 SHA256。程序不访问游戏服务、不修改该目录；未初始化或数据版本错误时启动失败，不监听端口。

- 仅监听 `127.0.0.1`，不提供公网监听选项。
- `GET /health`：本地健康状态。
- `POST /api/v1/arrange`：接收包含原始 `troop` / `building` 层级的 JSON，返回经过领域合法性与隔离检查的单次安排；可接收完整 PlayerData，无关字段不进入排班快照或响应。正文上限 1 MiB，超限返回 413。
- Ctrl+C 关闭服务及计算线程。
- 默认计算预算为 2000 节点，工作线程超时 5 秒，最多等待 2 个计算请求。预算不足时可能只返回当前可行解，不保证最优；没有可靠方案则返回错误。

当前成功体的顶层结构为：

```text
data.arranged    Control / Power / Manufacture / Trading / Dormitory / Meeting / Hire 七类数组
diagnostics      兼容范围、数据版本、隔离/排除原因、搜索及休息情况
```

`diagnostics.compatibility = arkhost-assignment-v1`、`scope = single-arrangement`、`gameExecutionVerified = false` 明确这只是已验证的单次安排消费合同。每间房的 `CharNum` 是总岗位数，人员用 `RoomChar[].Inst.Inst` 表示；空位由消费方补 `-1`。没有实例时输出空 `RoomChar`，不输出 null 人员或 null Inst。

`diagnostics.mode = partial` 表示存在未参与优化的区域或候选人，不能理解为完整收益优化。训练室和加工站人员保留原岗；锁定表中零驻员的活动室、电梯、走廊只保留设施状态。未知房型或锁定表未定义的 SHOP / RECYCLE 继续拒绝。任何错误响应均不含可执行安排。

HTTP 默认采用生产优先的实用排班：在固定预算内比较制造产量与贸易龙门币收入，赤金产量、消耗和净结余单独核算。线索类别偏好不参与生产评分，技能中已知的速度、心情及伙伴效果仍参与计算；特殊与品质订单使用长期新订单近似，并在诊断中列出实际生效的假设。它不预测当前订单或第一小时收入，也不保证每种产物都提高。

需要严格机制求值时使用内部 `arrangePreview` 及相应条件入口；HTTP 不读取调用方追加的历史或情景开关。实用近似不等于精确技能覆盖或实机认证。

## ArkHost 接入与回退

配套的 ArkHost 接入改动支持进程环境变量 `ARKHOST_SCHEDULING_BASE_URL`。在与服务处于同一网络命名空间时，可设为 `http://127.0.0.1:8787`；这里填写基础地址，客户端追加 `/api/v1/arrange`。服务与 ArkHost 分处容器时，不能直接把另一容器的 `127.0.0.1` 当成本服务地址。实际部署需另行确认网络与授权。

客户端须检查 HTTP 状态、严格校验字段类型，并在任何换班请求前完成全部房间的预检；保留房内座位顺序，同房换座也必须执行。第 N 房失败应立即停止后续房间，不能报告整批成功或根据旧快照自动回滚。这些保护需要配套 ArkHost 改动，服务本身不能替旧版客户端执行。

恢复旧排班地址时，清空 `ARKHOST_SCHEDULING_BASE_URL` 并重启 ArkHost。地址回退不会撤销已执行的游戏安排；再次规划前应重新同步，不能用旧快照发送恢复指令。当前接入仅通过本地隔离验证，尚无真实换班验收。

## 验证

从本目录运行：

```sh
node --test test/**/*.test.mjs
node scripts/check-data.mjs
node scripts/benchmark.mjs
```

不要直接运行不限定测试文件的 `node --test`：`test/fixtures/runtime-worker.mjs` 是专门模拟卡死等异常的工作线程夹具，不应作为独立测试入口。

`check-data` 输出逐条覆盖报告；`compiled` 表示技能 ID、房间和完整描述指纹匹配已登记效果，不代表逐技能数值验收。`numericallyVerified` 与未支持清单须单独检查。

基准使用合成玩家，默认 252/243 布局、80/429 人、精零一级、2000 节点。可通过 `BENCH_SAMPLES`、`BENCH_NODES` 环境变量调整采样次数和预算。结果不等于精二复杂组合质量验收，也不等于 HTTP 吞吐或生产 SLA。

## 技能维护

`src/mechanisms/registry.mjs` 是唯一技能登记表：`buffId → 房间、描述 SHA256、effects`，由现有求值器计算。描述只用于发现数据漂移，不再解析文案或按 ID 前缀猜效果。

- 新角色复用已有技能 ID：仅更新数据，解锁条件仍读取角色表。
- 新技能 ID 或已有 ID 变参：审阅完整效果，登记参数与描述指纹，并增加独立数值用例；不修改通用算法即可表达时不增加处理器。
- 真正新机制：增加最小处理逻辑与黄金测试，不把未知部分当作零效果。
- 未支持技能的 `isolation` 仅记录已知影响边界：`local` 为本房效果，`inactiveOnly` 为未入驻不触发；这不表示已经会计算。未登记、描述或房间漂移时旧边界失效，无法隔离即拒绝。

登记来源记录在 `registrySource`，更新数据时同时核对；不需要运行代码生成器、迁移脚本或安装工具。`test/fixtures/mechanism-records.json` 仅为合成测试的静态输入，不能加入生产登记或作为数值预期。

## 新订单的内部条件计算

`evaluateNewOrderCandidate` 仅供本地计算验证，必须显式传入 `steady-new-gold-orders`。它按持续交付、原料充足、不满仓和人员状态稳定计算新订单的长期速率，计入赤金消耗；它不预测现有订单或换班生效时间。收入与资源净变化互有优劣时保留不可比较状态。

登记中的 `newOrderEffects` 保存16条订单技能的完整条件效果（8条特殊订单、8条品质订单）；严格的默认 `compileBuff` 不启用这些字段。HTTP worker 在内部实用模型中复用长期投影，品质订单使用已知峰值及已明确的组合，未知组合仍拒绝；诊断须保留原料、持续交付和暖机峰值假设。没有面向请求 JSON 的开启开关，这些近似条目不计入默认精确覆盖。相关测试为 `test/mechanisms/gold-orders.test.mjs`、`test/solver/new-orders.test.mjs`、`test/solver/quality-orders.test.mjs` 和 `test/runtime/approximate-schedule.test.mjs`。

## 已确认状态的内部计算

`src/solver/confirmed-state.mjs` 的 `evaluateConfirmedStateCandidate` 使用明确给定且与完整候选安排匹配的状态，计算累计工作时间、交流、训练、宿舍锁定恢复和线索保底；可以与新订单条件计算组合使用。它不解释原始时间字段，也不推断历史目标或换岗顺序。`applyConfirmedDormEntry` 仅计算明确进驻事件后的心情快照，不修改输入、不执行换班。

暖机默认仅能确定新增、换房或换座后的首小时；同房同座且历史未知时继续保护。26条单体恢复及菲亚梅塔进驻交换已按可确定的座位事件接入默认路径；旧目标或入驻先后不确定时仍拒绝依赖该历史的候选。2条线索保底仍需显式状态，16条订单保留独立条件求值；实用 HTTP 的近似与这些严格入口分开。

缺少状态、状态对应另一份安排或技能数据漂移时明确拒绝。锁定单体恢复按目标取最高，不能凭当前心情猜测历史绑定。相关回归见 `test/solver/confirmed-state.test.mjs`、`test/mechanisms/dorm-targets.test.mjs` 和 `test/mechanisms/work-hours.test.mjs`。

## 数据升级与回滚

数据来源为上述标准 Git submodule，gitlink 和 `dataPin.commit` 必须保持一致；运行时另外校验四份表的内容散列。已有 checkout 也必须满足相同版本锁。

维护者在独立目录核查候选数据版本及四份表的散列，运行覆盖报告、机制黄金测试与合成请求回归后，才可同时更新 submodule gitlink 和版本锁。散列匹配不等于新机制已支持。不要原地覆盖正在使用的数据副本；保留旧目录及旧版本锁。回滚时恢复旧服务提交、对应 gitlink 和版本锁，执行 `git submodule update --init --depth 1` 后重启；启动失败时不会自动忽略散列检查。请求内不联网更新数据。

## 未完成边界

- 固定542条技能中，485条有默认独立增量证据；剩余57条为2条线索状态条件、16条订单条件、39条完整数值机制未实现。实用路径对41条线索及16条订单的处理不提升此精确覆盖数；未知概率不填零或猜值。
- 不同资源之间的价值换算未确认；生产优先搜索按制造产量和贸易收入推进，可能发生分项取舍。贸易增收可能增加赤金净流出，不能据此承诺库存可持续或所有产物都增产。
- 已核实的 ArkHost 换班链只消费安排字段；ApCost、ExtraScore、ProdSpeed、Capacity/RawCap、Buffs 等附加指标未定义，继续省略。其他消费链与完整公开 API 替代仍需各自验收。
- 没有真实账号、真实换班、公开入口或部署验收。

测试通过与合法安排均不代表上述缺口已经解决。
