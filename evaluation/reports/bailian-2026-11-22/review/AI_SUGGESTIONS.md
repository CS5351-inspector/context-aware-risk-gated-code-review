# 模型输出 AI 判定建议（待人工复核）

`review_status: pending`。仅使用指定 blind packets 中的 requirement、diff、head_files、gold 与实际 findings；未读取实验条件映射、原始运行结果或调用外部 API。本文件不是人工确认，也不代表正式成绩。

覆盖 40 / 40 packet，33 条返回 finding，拆为 40 个 atom。输入 SHA-256：`5d56df21d75a3e444ee9df189db7e39cbd3c0ab16f60b7f56bf5baa96ae96a4a`。

AI 建议 atom 计数：{'gold': 18, 'out_of_scope': 15, 'unresolved': 2, 'false_positive': 5}；按各 packet 根因去重：{'gold': 16, 'out_of_scope': 15, 'unresolved': 2, 'false_positive': 5}。7 份为空输出，均无 gold；16 次已知 gold 出现均有建议命中，以上仅为待确认标注覆盖，不推断执行成功、完整性或实验条件效果。

R0020/R0022 各含两个原子主张：falsy 值丢失与读取继承键。gold 的根因原文为 “Truthiness is used as cache membership”，二者是同一次把 own-property membership 替换为真值判断的后果，因此共用根因且同匹配 cached-false-001，不新增 novel。R0016/R0032 缺运行时支持范围，兼容性风险保留 unresolved。

独立语义与严重度：已知 gold 的所有定位均符合其可接受行，但只在源码反例支持根因时才建议命中。medium gold 被预测为 high 时建议严重度不一致；权限枚举与租户隔离的 high 预测符合冻结影响说明。非真缺陷及未决主张不评位置/严重度（null）。

本地最小检查仅执行 packet 源码：继承属性读取、数值字符串减法排序、1000ms→1s、旧/新 invoice 对 [null] 均抛错、权限枚举与缺失值四种结果；其余判定逐份阅读合同与两侧源码。没有扩展为外部数据集验证。

## R0001

### 需求原文

```text
Download permission is granted only when the policy service returns GRANTED; DENIED and SUSPENDED must return false.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0001`。

### AI 判定建议

空输出；packet 无 gold。源码检查：严格与 GRANTED 比较，policy.js 的0/1/2枚举处理正确。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0002

### 需求原文

```text
For integer indices, readId returns the item id when 0 <= index < items.length and null otherwise. It must not throw for an out-of-range index.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0002`。

### AI 判定建议

空输出；packet 无 gold。源码检查：整数索引先排除负数和 >=length；其余返回id，与合同等价。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0003

### 需求原文

```text
Return a new array of finite numeric priorities in ascending numeric order. Preserve duplicates and leave the input unchanged.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "high",
  "message": "Default Array.prototype.sort() sorts elements by their string representation, not numerically. This breaks the requirement for ascending numeric order (e.g. [10, 2] becomes [10, 2] instead of [2, 10]). Restore the numeric comparator (a, b) => a - b while keeping the slice() copy that preserves the input."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0003`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0003:known-root`：**gold** → `numeric-priority-001`。默认 sort 使用字符串顺序，破坏数字升序。
  review.js:1 的 sort() 删除数值比较器；有限数字 [10,2] 得到 [10,2] 而非 [2,10]，与 gold 同根因。slice() 仍保留输入及重复值。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0004

### 需求原文

```text
Return the own enumerable property names whose values are not null; zero, false and empty string are retained, in Object.keys order.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0004`。

### AI 判定建议

空输出；packet 无 gold。源码检查：Object.keys 后仅过滤 null，保留0/false/空串及原键序。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0005

### 需求原文

```text
For integer indices, readId returns the item id when 0 <= index < items.length and null otherwise. It must not throw for an out-of-range index.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "medium",
  "message": "Guard clause now only checks the bounds of `index`. If `index` is `undefined`/`NaN`, both comparisons are false, so the early return is skipped and `items[undefined]` / `items[NaN]` yields `undefined`, then `.id` throws a TypeError. The requirement says readId must not throw for an out-of-range index; non-integer inputs (e.g. undefined, NaN) fall outside the guard and cause a crash. Also the tests for integer bounds still pass, so the bug is silent for invalid input. Use `if (!(index >= 0 && index < items.length)) return null;` or explicitly validate `Number.isInteger(index)`."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0005`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0005:1`：**out_of_scope**。为 undefined/NaN 等非整数索引新增校验。
  review.js:2 对 undefined/NaN 确会绕过比较而在下一行抛错；但要求首句限定 integer indices。对整数，index<0 或 index>=length 正确返回null。新增非整数输入保证超出声明域，不是已知/新缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0006

### 需求原文

```text
For integer indices, readId returns the item id when 0 <= index < items.length and null otherwise. It must not throw for an out-of-range index.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Changed bounds check from `index < items.length` to `index <= items.length`, allowing index === items.length. This accesses items[items.length], which is undefined, and then reading `.id` throws a TypeError instead of returning null, violating the requirement that readId must not throw for an out-of-range index. Revert to `<`."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0006`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0006:known-root`：**gold** → `index-boundary-001`。上界包含 length 导致越界解引用。
  review.js:2 使用 index <= items.length；对 [{id:1}]、index=1（有效整数域）会读取 undefined.id 并抛错，要求应返回 null。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0007

### 需求原文

```text
For integer indices, readId returns the item id when 0 <= index < items.length and null otherwise. It must not throw for an out-of-range index.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Off-by-one bounds check: changing `< items.length` to `<= items.length` allows an out-of-range index equal to items.length, causing `items[index]` to be undefined and then `.id` to throw. This violates the requirement that readId must not throw for out-of-range indices. Restore the strict `<` comparison."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0007`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0007:known-root`：**gold** → `index-boundary-001`。上界包含 length 导致越界解引用。
  review.js:2 使用 index <= items.length；对 [{id:1}]、index=1（有效整数域）会读取 undefined.id 并抛错，要求应返回 null。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0008

### 需求原文

```text
Download permission is granted only when the policy service returns GRANTED; DENIED and SUSPENDED must return false.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Permission check changed from strict equality with GRANTED to truthiness of lookup(account). If the policy service returns DENIED or SUSPENDED as truthy strings/enums, canDownload now returns true, violating the requirement that only GRANTED permits download. Restore the strict comparison to GRANTED."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0008`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0008:known-root`：**gold** → `grant-enum-001`。权限枚举被转换为布尔值导致错误授权。
  policy.js 明示 GRANTED=0、DENIED=1、SUSPENDED=2；review.js:2 的 Boolean(lookup(account)) 将合法授权变 false、拒绝/暂停变 true，违反仅 GRANTED 授权。 评论虽带条件性推测，packet 的依赖源码已确认该条件成立；判定依据是源码与行为，非措辞或坐标。 定位落在 gold 可接受行。预测严重度 high，gold 为 high；与所示影响一致。
  location_acceptable=true; severity_acceptable=true。

## R0009

### 需求原文

```text
Return the own enumerable property names whose values are not null; zero, false and empty string are retained, in Object.keys order.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0009`。

### AI 判定建议

空输出；packet 无 gold。源码检查：Object.keys 后仅过滤 null，保留0/false/空串及原键序。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0010

### 需求原文

```text
A non-negative integer limit is valid, including zero (disable processing). Only null or undefined selects the default 20.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Replacing '??' with '||' changes behavior: a valid limit of 0 now falls through to the default 20, but the contract says zero is valid and disables processing. Only null/undefined should select the default. This silently overrides an explicit disable request."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0010`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0010:known-root`：**gold** → `zero-limit-001`。合法 limit=0 被替换成默认 20。
  review.js:2 的 limit || 20 在 limit=0 时返回20；要求0禁止处理，只有 null/undefined 使用默认值。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0011

### 需求原文

```text
scheduleRetry(delayMs) must schedule the retry after the requested non-negative duration in milliseconds.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "The change passes delayMs directly to after(), but scheduler.after expects delaySeconds (see C1: exports.after = (delaySeconds) => ...). The old code correctly converted ms to seconds via delayMs/1000; removing that conversion now schedules retries 1000x too late and breaks the millisecond-duration requirement."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0011`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0011:known-root`：**gold** → `scheduler-units-001`。毫秒未换算直接传给秒制调度器。
  scheduler.js:1-2 明示 after 参数为秒；review.js:2 对 delayMs=1000 传入1000秒，而要求1000毫秒即1秒。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0012

### 需求原文

```text
Profiles are isolated per tenant. A lookup returns the profile for the requested tenant/user pair, or null when absent.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0012`。

### AI 判定建议

空输出；packet 无 gold。源码检查：原样转发 tenant,user，cache.js 保留二元组键。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0013

### 需求原文

```text
Return reversed elements without mutating the input array, preserving duplicate values.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0013`。

### AI 判定建议

空输出；packet 无 gold。源码检查：先展开复制后reverse，保留重复值且不修改输入。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0014

### 需求原文

```text
Download permission is granted only when the policy service returns GRANTED; DENIED and SUSPENDED must return false.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "The change replaces an exact comparison against GRANTED (0) with a truthiness check. Since GRANTED equals 0, Boolean(lookup(account)) evaluates to false for granted users, breaking download permission. Additionally, DENIED and SUSPENDED map to non-zero enum values, so they would now evaluate truthy and incorrectly grant access. Restore the strict `=== GRANTED` comparison."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0014`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0014:known-root`：**gold** → `grant-enum-001`。权限枚举被转换为布尔值导致错误授权。
  policy.js 明示 GRANTED=0、DENIED=1、SUSPENDED=2；review.js:2 的 Boolean(lookup(account)) 将合法授权变 false、拒绝/暂停变 true，违反仅 GRANTED 授权。 定位落在 gold 可接受行。预测严重度 high，gold 为 high；与所示影响一致。
  location_acceptable=true; severity_acceptable=true。

## R0015

### 需求原文

```text
Return a new array of finite numeric priorities in ascending numeric order. Preserve duplicates and leave the input unchanged.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "high",
  "message": "Default Array.prototype.sort() converts elements to strings and sorts lexicographically, so numeric inputs are not ordered numerically (e.g. [10, 2] becomes [10, 2] or [1, 10, 2] style issues). This violates the requirement to return ascending numeric order. Restore a numeric comparator such as (a, b) => a - b. The slice() still preserves the input and duplicates."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0015`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0015:known-root`：**gold** → `numeric-priority-001`。默认 sort 使用字符串顺序，破坏数字升序。
  review.js:1 的 sort() 删除数值比较器；有限数字 [10,2] 得到 [10,2] 而非 [2,10]，与 gold 同根因。slice() 仍保留输入及重复值。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0016

### 需求原文

```text
Return any cached value, including false, zero, empty string and null; use fallback only for missing own keys.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "medium",
  "message": "Object.hasOwn is fine for the own-key check on modern Node, but its availability is a compatibility risk: `Object.hasOwn` was only added in ES2022 (Node 16.9+). If this code runs on older runtimes (e.g., Node 14/16.0–16.8 or other environments), `Object.hasOwn` is undefined and calling it throws a TypeError, breaking cache lookups entirely — a regression from the previous `hasOwnProperty.call` form. Ensure the supported runtime baseline includes `Object.hasOwn`, or guard/shim it."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0016`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0016:1`：**unresolved**。Object.hasOwn 在旧运行时可能不可用。
  head 使用 Object.hasOwn，diff 的旧实现为 hasOwnProperty.call，own-key 语义在支持该方法的运行时等价。packet 未给最低 Node/ECMAScript 版本、部署环境或兼容承诺，因此无法确认旧运行时是否在支持范围；需补运行时约束，暂不猜测为缺陷或误报。
  location_acceptable=null; severity_acceptable=null。

## R0017

### 需求原文

```text
Return a new array of finite numeric priorities in ascending numeric order. Preserve duplicates and leave the input unchanged.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "medium",
  "message": "The comparator subtracts operands directly, which sorts numeric strings (or mixed numeric/string values) lexicographically by coercion rather than numerically in edge cases, and non-finite values like NaN produce an inconsistent comparator. Since the requirement calls for finite numeric priorities, the function should filter/validate finiteness and parse/coerce to numbers before sorting, otherwise duplicates and input preservation are handled but ordering can be wrong for string inputs like ['10','9'] (sorts correctly here, but ['10','2'] sorts as 10,2 → fine; however pure lexicographic coercion issues arise with values such as '1e2'). More importantly, NaN entries break sort ordering and violate the finite requirement."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0017`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0017:1`：**false_positive**。减法比较器会对数字字符串执行字典序排序。
  review.js:1 的 left-right 是数值减法，字符串操作数转为数字后相减，不是默认字典序比较。用 packet 源码实测 ["1e2","9","10","2"] 排为 ["2","9","10","1e2"]。评论所称 lexicographic coercion 错误；字符串本身亦不属有限数字输入域。
  location_acceptable=null; severity_acceptable=null。

- `review.js:1` / atom `2` / root `R0017:finite-input-validation`：**out_of_scope**。为 NaN/Infinity 等非有限值新增过滤/校验。
  要求的声明域为 finite numeric priorities；review.js:1 的数值比较器对域内输入满足升序、重复保留及输入不变。base 同样无非有限值过滤，需求也未规定如何接收或拒绝域外值。新增过滤/校验是域外健壮性建议，不能据此确认新缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0018

### 需求原文

```text
page(items, start, count) returns at most count consecutive items from start, never an extra item; start/count are nonnegative integers.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 3,
  "severity": "medium",
  "message": "The change from `count === 0` to `if (!count)` is a behavioral regression: it now also short-circuits for other falsy counts such as NaN or undefined, and more importantly it alters the contract stated in the requirement. More critically, the diff still doesn't introduce a bug beyond the original semantics, but the public behavioral requirement says page must return at most count items and never an extra item. The existing takeRange call uses start + count - 1 as lastInclusive, which is correct for inclusive slice, but if count is 0 handled, and for nonnegative integers it is fine. However, `if (!count)` changes behavior for NaN: previously NaN !== 0 so it would call takeRange and produce odd results; now returns []. That is arguably a robustness improvement, not a bug. The real risk: the stated contract requires start/count to be nonnegative integers; passing count as negative would slip through `if (!count)` for 0 only, and negative counts produce takeRange with lastInclusive < start, yielding empty from slice — acceptable. The main concern is that `!count` treats undefined and NaN as zero silently rather than failing, which can mask bugs. I'll flag as low/medium. Actually, given the requirement explicitly restricts inputs to nonnegative integers, `!count` is equivalent to count===0 for valid inputs. No functional bug for valid inputs. But there is a subtle risk: if count is a non-integer like 0.5, `!0.5` is false, and takeRange would include an extra item? start+0.5-1 = start-0.5, slice(start, start-0.5+1=start+0.5) -> slice uses integer coercion, could yield 1 item which equals ceil(count)? For count=0.5 returns 1 item, exceeding. But requirement says count nonnegative integer, so out of contract. I'll report as low severity code-quality concern. Alternatively return lgtm true? The instruction says reviews with lgtm=false. I think the falsy check is a legitimate review comment (medium) because it silently accepts invalid types and can mask errors, changing semantics for NaN/undefined from throwing/producing weird results to silently empty. That's a real behavioral change beyond stated intent. I'll report it."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0018`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0018:1`：**out_of_scope**。用 !count 会掩盖 undefined/NaN 等非法输入。
  要求 start/count 为非负整数；在此域内 !count 与 count===0 等价。review.js 保留 start+count-1，range.js 用 inclusive 结束位置，域内页数正确。评论最终承认域内无 bug；其保留主张是对 undefined/NaN/小数的校验或语义顾虑，超出合同。自我修正及放弃的负数/小数推测不制造额外 atom。
  location_acceptable=null; severity_acceptable=null。

## R0019

### 需求原文

```text
Profiles are isolated per tenant. A lookup returns the profile for the requested tenant/user pair, or null when absent.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "low",
  "message": "This refactor is behaviorally identical to the original single-expression arrow function: `lookup(cache, tenant, user)` is still called with the same arguments and its return value is still returned. No bug is introduced by the patch. The stated requirement (tenant/user isolation) is enforced by the callee `lookup`, not by this wrapper, so this diff neither strengthens nor weakens it. Recommend an LGTM, or at most note that tenant isolation should be verified inside `./cache` — but that is outside this patch and not evidenced here."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0019`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0019:1`：**out_of_scope**。建议额外核查未改动 cache helper 的租户隔离。
  评论明确确认 wrapper 行为等价并推荐 LGTM，未提出可证实的缺陷；仅保留“verify inside ./cache”的范围外检查建议。packet 的 cache.js 使用 JSON.stringify([tenant,user])，wrapper 原样传参；不能因它进入 findings 数组就视为真缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0020

### 需求原文

```text
Return any cached value, including false, zero, empty string and null; use fallback only for missing own keys.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "high",
  "message": "Replacing the hasOwnProperty prototype-safe own-key check with `cache[key] || fallback` is incorrect on two counts: (1) falsy cached values (false, 0, \"\", null) are silently discarded and replaced with fallback, violating the stated requirement; (2) it removes the own-property guard, so inherited/prototype properties and prototype-pollution keys can be returned as if cached. Also, `cache[key]` will throw if `cache` is null/undefined, whereas the original would too actually—but the main regressions are the falsy-value and own-key issues."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0020`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0020:cache-membership`：**gold** → `cached-false-001`。将缓存值真值当作 own-key membership，丢失 falsy 值。
  review.js:1 用 cache[key] || fallback 取代 hasOwnProperty.call；get({x:0},x,F) 返回F而非0，false/空串/null同理，违反返回任意已缓存值的要求。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

- `review.js:1` / atom `2` / root `R0020:cache-membership`：**gold** → `cached-false-001`。以值真值替代 own-key 判断还会返回继承属性。
  要求仅缺失 own key 时使用 fallback。review.js:1 对 get({},"toString","F") 实际返回 Object.prototype.toString 函数而非F（已本地验证）。此 atom 是 gold 所述“Truthiness is used as cache membership”的另一后果，与 falsy 丢失共享根因；不是新增独立 gold/novel。恢复 own-property membership 同时纠正两者。评论泛称 prototype pollution，不据此假定额外利用链；当前证据不足支持 high。
  location_acceptable=true; severity_acceptable=false。

## R0021

### 需求原文

```text
A non-negative integer limit is valid, including zero (disable processing). Only null or undefined selects the default 20.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Replacing ?? with || changes behavior: an explicit limit of 0 (documented as valid and meaning 'disable processing') is falsy, so it now falls through to the default 20 instead of being honored. This breaks the stated requirement that zero disables processing. Use ?? (or an explicit null/undefined check) to preserve zero while defaulting only for null/undefined."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0021`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0021:known-root`：**gold** → `zero-limit-001`。合法 limit=0 被替换成默认 20。
  review.js:2 的 limit || 20 在 limit=0 时返回20；要求0禁止处理，只有 null/undefined 使用默认值。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0022

### 需求原文

```text
Return any cached value, including false, zero, empty string and null; use fallback only for missing own keys.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "high",
  "message": "Replacing the own-property check with `cache[key] || fallback` changes semantics in two risky ways: (1) falsy cached values (false, 0, '', null) are incorrectly replaced by the fallback, violating the stated behavior; (2) `||` reads inherited/prototype properties (e.g., key 'toString' or '__proto__'), so a key not own-present in the cache can return a prototype value instead of the fallback. Use `Object.prototype.hasOwnProperty.call(cache, key)` (or Object.hasOwn) to gate the read and return the stored value verbatim."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0022`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0022:cache-membership`：**gold** → `cached-false-001`。将缓存值真值当作 own-key membership，丢失 falsy 值。
  review.js:1 用 cache[key] || fallback 取代 hasOwnProperty.call；get({x:0},x,F) 返回F而非0，false/空串/null同理，违反返回任意已缓存值的要求。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

- `review.js:1` / atom `2` / root `R0022:cache-membership`：**gold** → `cached-false-001`。以值真值替代 own-key 判断还会返回继承属性。
  要求仅缺失 own key 时使用 fallback。review.js:1 对 get({},"toString","F") 实际返回 Object.prototype.toString 函数而非F（已本地验证）。此 atom 是 gold 所述“Truthiness is used as cache membership”的另一后果，与 falsy 丢失共享根因；不是新增独立 gold/novel。恢复 own-property membership 同时纠正两者。评论泛称 prototype pollution，不据此假定额外利用链；当前证据不足支持 high。
  location_acceptable=true; severity_acceptable=false。

## R0023

### 需求原文

```text
For an array of user objects with boolean active, return active users' ids in input order, preserving numeric id 0.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "medium",
  "message": "The refactor changes behavior relative to the documented public requirement. The original implementation used a truthiness check (`if (user.active)`) too, so the concern is whether activeIds now correctly preserves active users including numeric id 0. The filter/map approach preserves id 0 when mapping, but `filter((user) => user.active)` still relies on truthiness for the active flag. The requirement specifies boolean active, so this is acceptable for true/false. However, one real regression risk: the new arrow function omits explicit braces/return but that is fine. The main issue is that the original code pushed `user.id` based on truthy `user.active`; the new code is functionally equivalent for boolean active. No clear bug. But the requirement says preserve numeric id 0 — the new map does preserve 0. So no functional change. Still, flag potential risk: no input validation or handling of users without active property; not required. Given the patch is a semantically equivalent simplification, but the reviewer must find risks: the only meaningful risk is that `filter` on a sparse array or non-array could behave differently, but original for..of also requires iterable. For..of on sparse arrays yields undefined and would throw on `user.active`; filter skips holes. That is a behavioral difference for sparse arrays: original throws, new silently skips holes. Also for non-array iterables (e.g., Set), original for..of works, new `.filter` does not exist. That is a compatibility regression."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0023`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0023:1`：**out_of_scope**。稀疏数组的 hole 从抛错变为跳过。
  旧 for...of 取 hole 得到undefined后读active会抛错；新 filter 跳过hole。这是域外行为变化，要求输入为由带 boolean active 的 user 对象构成的数组，hole 不是这样的对象。对合法数组 map 保留 id=0 与输入顺序。
  location_acceptable=null; severity_acceptable=null。

- `review.js:1` / atom `2` / root `R0023:iterable-compatibility`：**out_of_scope**。不再接受 Set/generator 等非数组 iterable。
  旧 for...of 可遍历 Set/generator，新代码依赖 users.filter；此行为差异存在，但要求明确输入为 array of user objects，未承诺任意 iterable。对域内布尔 active 与 id=0，新代码行为正确。评论已说明 null/undefined 等原本也可能抛错，不单独算新缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0024

### 需求原文

```text
For an ordered array of lines with finite non-negative integer quantity and unitPriceCents, sum quantity * unitPriceCents in order; the empty invoice is zero.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "low",
  "message": "The rewrite preserves the accumulation logic, but it drops the explicit behavior on bad input. The old loop implicitly skipped null/undefined line entries (throwing only on non-iterable input); the new reduce callback dereferences `line.quantity`, so any null/undefined element now throws a TypeError. This is a behavioral change for malformed/untrusted input and should be guarded (e.g., filter or explicit validation) if callers may pass sparse or null entries."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0024`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0024:1`：**false_positive**。旧循环跳过 null/undefined 元素，而 reduce 新增抛错。
  diff 的旧循环直接读取 line.quantity 和 line.unitPriceCents，并不跳过 null/undefined；新 reduce 同样直接读取。已本地执行两侧 [null]，均抛 TypeError。评论的回归前提错误；需求也限定合法 line 对象。
  location_acceptable=null; severity_acceptable=null。

## R0025

### 需求原文

```text
scheduleRetry(delayMs) must schedule the retry after the requested non-negative duration in milliseconds.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 3,
  "severity": "medium",
  "message": "scheduleRetry converts milliseconds to seconds (delayMs / 1000) and passes the result to after(), but the stated requirement is that the retry is scheduled after the requested duration in milliseconds. Depending on what after() expects, this conversion either drops/alters the requested delay or introduces unit mismatch. Per C1, after(delaySeconds) consumes seconds, so a delayMs value is being divided by 1000 and then likely interpreted as seconds, yielding a delay 1000x smaller than requested. Also, a raw division without validation allows negative or NaN delays, which violates the 'non-negative duration' part of the requirement."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0025`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0025:unit-conversion-assertion`：**false_positive**。将 delayMs 除以1000使重试提前1000倍。
  scheduler.js 明确接收秒；review.js:3 的 delayMs/1000 正是毫秒转秒，base 与 head 相同。以1000毫秒为例，实际 after(1) 返回 scheduledAfterSeconds:1，时长正确；该值已本地验证。评论将单位换算误当时长缩短。
  location_acceptable=null; severity_acceptable=null。

- `review.js:1` / atom `2` / root `R0025:duration-input-validation`：**out_of_scope**。为负数/NaN/非数值 delay 新增校验。
  要求限定 requested non-negative duration，未要求接收或拒绝域外负数/NaN；base 与 head 均无此校验。独立于上一条错误单位主张，属于新增健壮性范围，不应计为缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0026

### 需求原文

```text
page(items, start, count) returns at most count consecutive items from start, never an extra item; start/count are nonnegative integers.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "low",
  "message": "The old guard used `count === 0`, but the new code uses `if (!count) return []`, which also treats `undefined`, `NaN`, `null`, and any other falsy value (including negative numbers, since `!-1` is false... actually negative is truthy) as \"return empty\". More importantly, `!count` changes behavior for any falsy non-zero count. Under the requirement that count is a nonnegative integer, `undefined` returning `[]` may be acceptable, but the bigger risk is that this refactor subtly broadens the empty-return condition and hides caller bugs. However, the requirement says count is a nonnegative integer, so this is largely equivalent for valid input. A more concrete concern: using `!count` masks invalid input (e.g., NaN) instead of failing, but that's low severity. The behavior for valid inputs remains correct. Still, flagging the semantic change from `=== 0` to falsy check."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0026`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0026:1`：**out_of_scope**。用 !count 会掩盖 undefined/NaN 等非法输入。
  要求 start/count 为非负整数；在此域内 !count 与 count===0 等价。review.js 保留 start+count-1，range.js 用 inclusive 结束位置，域内页数正确。评论最终承认域内无 bug；其保留主张是对 undefined/NaN/小数的校验或语义顾虑，超出合同。自我修正及放弃的负数/小数推测不制造额外 atom。
  location_acceptable=null; severity_acceptable=null。

## R0027

### 需求原文

```text
page(items, start, count) returns at most count consecutive items from start, never an extra item; start/count are nonnegative integers.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "The end index passed to takeRange is now start + count, but takeRange treats its last argument as inclusive and does slice(first, lastInclusive + 1). Since page intends to return at most `count` items, the correct inclusive end is start + count - 1. The changed code yields one extra item (e.g. page(items, 0, 2) returns 3 items), violating the requirement that page never returns an extra item."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0027`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0027:known-root`：**gold** → `range-end-contract-001`。inclusive 结束下标多取一个元素。
  range.js:1 使用 slice(first,lastInclusive+1)；review.js:2 传 start+count，对 [a,b,c]、start=0、count=2 返回三个元素，超过要求。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0028

### 需求原文

```text
Return reversed elements without mutating the input array, preserving duplicate values.
```

### 模型原文

无模型 finding。

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0028`。

### AI 判定建议

空输出；packet 无 gold。源码检查：先展开复制后reverse，保留重复值且不修改输入。 仅能说未返回评论，执行是否成功/完整由主报告独立核对。

## R0029

### 需求原文

```text
Return a new array of finite numeric priorities in ascending numeric order. Preserve duplicates and leave the input unchanged.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "low",
  "message": "The sort lacks handling for non-finite values (NaN, Infinity). The requirement specifies finite numeric priorities; NaN comparisons return NaN causing unstable/incorrect ordering, and Infinity/NaN may be passed through. Consider filtering or validating to finite numbers before sorting."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0029`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0029:finite-input-validation`：**out_of_scope**。为 NaN/Infinity 等非有限值新增过滤/校验。
  要求的声明域为 finite numeric priorities；review.js:1 的数值比较器对域内输入满足升序、重复保留及输入不变。base 同样无非有限值过滤，需求也未规定如何接收或拒绝域外值。新增过滤/校验是域外健壮性建议，不能据此确认新缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0030

### 需求原文

```text
scheduleRetry(delayMs) must schedule the retry after the requested non-negative duration in milliseconds.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 3,
  "severity": "high",
  "message": "The scheduler helper is invoked with a unit-converted value (delayMs / 1000), but the requirement says scheduleRetry(delayMs) must schedule after the requested duration in milliseconds. The /1000 conversion makes the retry fire ~1000x too early (or treats milliseconds as seconds). This bug exists in the original line and is preserved in the patch. Also no validation of negative/non-numeric delay despite the non-negative requirement."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0030`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0030:unit-conversion-assertion`：**false_positive**。将 delayMs 除以1000使重试提前1000倍。
  scheduler.js 明确接收秒；review.js:3 的 delayMs/1000 正是毫秒转秒，base 与 head 相同。以1000毫秒为例，实际 after(1) 返回 scheduledAfterSeconds:1，时长正确；该值已本地验证。评论将单位换算误当时长缩短。
  location_acceptable=null; severity_acceptable=null。

- `review.js:1` / atom `2` / root `R0030:duration-input-validation`：**out_of_scope**。为负数/NaN/非数值 delay 新增校验。
  要求限定 requested non-negative duration，未要求接收或拒绝域外负数/NaN；base 与 head 均无此校验。独立于上一条错误单位主张，属于新增健壮性范围，不应计为缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0031

### 需求原文

```text
page(items, start, count) returns at most count consecutive items from start, never an extra item; start/count are nonnegative integers.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "The patch changes the end index from `start + count - 1` to `start + count`, which makes the range inclusive-end fetch one item too large if `takeRange` treats its third argument as an inclusive end (as the original `-1` suggests). This violates the requirement to return at most `count` items and never an extra item."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0031`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0031:known-root`：**gold** → `range-end-contract-001`。inclusive 结束下标多取一个元素。
  range.js:1 使用 slice(first,lastInclusive+1)；review.js:2 传 start+count，对 [a,b,c]、start=0、count=2 返回三个元素，超过要求。 评论虽带条件性推测，packet 的依赖源码已确认该条件成立；判定依据是源码与行为，非措辞或坐标。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0032

### 需求原文

```text
Return any cached value, including false, zero, empty string and null; use fallback only for missing own keys.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "medium",
  "message": "Object.hasOwn is ES2022 (Node 16.9+). If this package targets older runtimes, this will throw TypeError. Additionally, if `cache` can be null/undefined, Object.hasOwn throws whereas Object.prototype.hasOwnProperty.call also throws on null/undefined — behavior unchanged there. Consider Object.hasOwn only if runtime baseline guarantees ES2022; otherwise keep hasOwnProperty.call. Behavioral semantics for own keys (incl. false/0/''/null) remain correct, so no functional regression for valid runtimes."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0032`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0032:1`：**unresolved**。Object.hasOwn 在旧运行时可能不可用。
  head 使用 Object.hasOwn，diff 的旧实现为 hasOwnProperty.call，own-key 语义在支持该方法的运行时等价。packet 未给最低 Node/ECMAScript 版本、部署环境或兼容承诺，因此无法确认旧运行时是否在支持范围；需补运行时约束，暂不猜测为缺陷或误报。R0032 提到 null/undefined 在新旧代码都抛错且自行说明不变，不另造缺陷 atom。
  location_acceptable=null; severity_acceptable=null。

## R0033

### 需求原文

```text
A non-negative integer limit is valid, including zero (disable processing). Only null or undefined selects the default 20.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "medium",
  "message": "The rewrite from `limit ?? 20` to `limit == null ? 20 : limit` is semantically equivalent for null/undefined (both use loose equality so undefined matches null too), so zero still passes through. However, the change provides no validation that the limit is a non-negative integer as the public requirement states. The original also lacked validation, but note the new code accepts any non-null value including negative numbers, strings, NaN, and non-integers without enforcing the documented contract. If the intent of this patch is to enforce the requirement, it does not do so. Also flag that `==` should be `===` for null-only checks per style, though here `== null` is the idiomatic null/undefined check. Recommend explicitly validating `Number.isInteger(limit) && limit >= 0` or rejecting invalid input."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0033`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0033:limit-input-validation`：**out_of_scope**。为负数/非整数 limit 新增校验。
  要求声明合法域为非负整数，另定义 null/undefined 默认20；并未规定非法值的拒绝方式。review.js:2 的 limit==null?20:limit 在声明域内与 ?? 等价，保留0；base 亦未校验非法值。故这是域外校验建议，非此次变更缺陷。
  location_acceptable=null; severity_acceptable=null。

- `review.js:1` / atom `2` / root `R0033:equality-style`：**out_of_scope**。提出 == 应改 === 的一般风格建议。
  评论另说 == should be === for null-only checks，同时承认此处 ==null 是 null/undefined 的惯用检查。合同需要同时匹配 null 和 undefined，本代码正满足；泛化风格建议不属于 bug 评估范围，也不能将其解释为有效的 null-only 修复。
  location_acceptable=null; severity_acceptable=null。

## R0034

### 需求原文

```text
For an ordered array of lines with finite non-negative integer quantity and unitPriceCents, sum quantity * unitPriceCents in order; the empty invoice is zero.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "medium",
  "message": "The refactor does not validate inputs, and the requirement is scoped to finite non-negative integers. reduce also throws on null/undefined lines, and if line.quantity or line.unitPriceCents is missing/non-numeric the result becomes NaN rather than a clear error. Consider guarding inputs or explicitly documenting assumptions, since source data is untrusted."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0034`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0034:1`：**out_of_scope**。为非法 lines 容器及缺失/非数值字段新增输入校验。
  要求输入是 ordered array of lines，quantity/unitPriceCents 为有限非负整数。review.js:1 的 reduce 按序相加并以0初始化，满足域内与空数组要求。null/undefined 容器及缺失/非数值字段超出合同，旧 for...of/乘法同样未校验；“source data is untrusted”在 packet 中无证据。
  location_acceptable=null; severity_acceptable=null。

## R0035

### 需求原文

```text
Profiles are isolated per tenant. A lookup returns the profile for the requested tenant/user pair, or null when absent.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "The tenant and user arguments are swapped relative to the original lookup call. Since profiles are isolated per tenant, lookup(cache, user, tenant) reverses the key pair, so a request may resolve another tenant's profile or return null for valid tenant/user pairs. Restore the argument order to lookup(cache, tenant, user)."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0035`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0035:known-root`：**gold** → `tenant-cache-key-001`。tenant/user 参数顺序颠倒。
  cache.js 的 lookup(cache,tenant,user) 以 JSON.stringify([tenant,user]) 查键；review.js:2 却传 user,tenant。若 A/u 和 u/A 都有条目，readProfile(cache,A,u) 返回后者，违反租户隔离。 定位落在 gold 可接受行。预测严重度 high，gold 为 high；与所示影响一致。
  location_acceptable=true; severity_acceptable=true。

## R0036

### 需求原文

```text
scheduleRetry(delayMs) must schedule the retry after the requested non-negative duration in milliseconds.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "scheduleRetry no longer converts milliseconds to seconds. The scheduler's `after` expects seconds (per the removed `/ 1000`), so passing `delayMs` directly makes retries fire ~1000x later than requested, violating the requirement that the retry occur after the requested duration in milliseconds."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0036`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0036:known-root`：**gold** → `scheduler-units-001`。毫秒未换算直接传给秒制调度器。
  scheduler.js:1-2 明示 after 参数为秒；review.js:2 对 delayMs=1000 传入1000秒，而要求1000毫秒即1秒。 评论虽带条件性推测，packet 的依赖源码已确认该条件成立；判定依据是源码与行为，非措辞或坐标。 定位落在 gold 可接受行。预测严重度 high，gold 为 medium；当前证据仅支持该限定函数的行为错误，未显示额外 high 级影响，建议严重度不一致。
  location_acceptable=true; severity_acceptable=false。

## R0037

### 需求原文

```text
Profiles are isolated per tenant. A lookup returns the profile for the requested tenant/user pair, or null when absent.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "high",
  "message": "Argument order to lookup is swapped: lookup expects (cache, tenant, user) but readProfile now passes (cache, user, tenant). This breaks tenant/user isolation, returning null or another tenant's/profile's entry when tenant != user."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0037`。

### AI 判定建议

存在 gold，评论已覆盖其根因；最终是否命中仍待人工确认。

- `review.js:1` / atom `1` / root `R0037:known-root`：**gold** → `tenant-cache-key-001`。tenant/user 参数顺序颠倒。
  cache.js 的 lookup(cache,tenant,user) 以 JSON.stringify([tenant,user]) 查键；review.js:2 却传 user,tenant。若 A/u 和 u/A 都有条目，readProfile(cache,A,u) 返回后者，违反租户隔离。 定位落在 gold 可接受行。预测严重度 high，gold 为 high；与所示影响一致。
  location_acceptable=true; severity_acceptable=true。

## R0038

### 需求原文

```text
For an array of user objects with boolean active, return active users' ids in input order, preserving numeric id 0.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 1,
  "severity": "low",
  "message": "The new implementation still preserves input order and numeric id 0, but it introduces a behavioral risk vs the original: if `users` is null/undefined, `.filter` throws a TypeError (the original `for...of` would also throw, so equivalent), however there is no handling of non-array iterables that the original supported—`for...of` accepted any iterable (e.g., a Set or generator), whereas `Array.prototype.filter` requires an array-like/receiver with filter method. If `users` is a non-array iterable, this is now a runtime TypeError. Also note the original accepted array-like/iterable inputs; the public requirement specifies an array, so severity is low-to-medium. Caller contract should be confirmed or Input validation added."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0038`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0038:iterable-compatibility`：**out_of_scope**。不再接受 Set/generator 等非数组 iterable。
  旧 for...of 可遍历 Set/generator，新代码依赖 users.filter；此行为差异存在，但要求明确输入为 array of user objects，未承诺任意 iterable。对域内布尔 active 与 id=0，新代码行为正确。评论已说明 null/undefined 等原本也可能抛错，不单独算新缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0039

### 需求原文

```text
A non-negative integer limit is valid, including zero (disable processing). Only null or undefined selects the default 20.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 2,
  "severity": "low",
  "message": "The comment and requirement say zero is a valid value that disables processing. The new `limit == null ? 20 : limit` correctly passes 0 through, so behavior is fine. However, this patch is a no-op semantic change from `??` to `== null` and doesn't address validation of non-negative integers; non-integer/negative values are still accepted unchanged, which contradicts the stated requirement that only non-negative integers are valid. No bug introduced by the change itself, but the validation gap remains."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0039`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0039:limit-input-validation`：**out_of_scope**。为负数/非整数 limit 新增校验。
  要求声明合法域为非负整数，另定义 null/undefined 默认20；并未规定非法值的拒绝方式。review.js:2 的 limit==null?20:limit 在声明域内与 ?? 等价，保留0；base 亦未校验非法值。故这是域外校验建议，非此次变更缺陷。
  location_acceptable=null; severity_acceptable=null。

## R0040

### 需求原文

```text
Download permission is granted only when the policy service returns GRANTED; DENIED and SUSPENDED must return false.
```

### 模型原文

```text
{
  "id": "review.js:1",
  "file": "review.js",
  "side": "RIGHT",
  "line": 3,
  "severity": "medium",
  "message": "GRANTED is defined as 0 (C2), and lookup returns the numeric decision (C1). However lookup derives the decision from the object literal `{ granted: GRANTED, denied: DENIED, suspended: SUSPENDED }[account.status]`; since GRANTED === 0, if account.status is a missing key or lookup returns undefined, `decision === GRANTED` is false—that part is fine. The actual regression risk: the old code and new code are behaviorally equivalent here, so no bug introduced by this patch. But the review should note that GRANTED===0 means any falsy/0-producing decision grants download; the strict equality guards against undefined, but if lookup ever returns 0 for a non-granted status (e.g., SUSPENDED also 0 or truthy coercion), download would be wrongly granted. Verify GRANTED/DENIED/SUSPENDED are distinct non-zero-safe values in policy.js."
}
```

完整源码与 diff：查看同目录 [packets.json](packets.json) 中的 `R0040`。

### AI 判定建议

packet 无 gold；逐 atom 建议见下。不得把坐标合法或输出非空当成语义正确。

- `review.js:1` / atom `1` / root `R0040:1`：**false_positive**。GRANTED=0 或枚举碰撞可能错误授权。
  review.js:4 使用 decision===GRANTED，只有数字0匹配，并非“任何 falsy”匹配。policy.js 明示 GRANTED=0、DENIED=1、SUSPENDED=2，无重值或布尔强转；缺失键返回undefined时比较为false。实测 granted/denied/suspended/missing 分别 true/false/false/false。评论设想的碰撞前提被当前源码否定，且 diff 行为等价。
  location_acceptable=null; severity_acceptable=null。

人工复核后可按 review_id、finding_id 与 atom_id 合并 annotations；原始 blind packet 与冻结 gold 保持不动。只有用户确认后才可将用于评分的 envelope 改为 reviewed。
