# 明日方舟基建排班 API

本仓库用于记录明日方舟基建排班服务的 HTTP API 协议。

本地单次排班参考实现的检出、启动、验证及兼容范围见 [SERVICE.md](SERVICE.md)。参考实现目前只验证了 ArkHost 单次安排消费所需字段，未实现下文全部收益指标，也未完成真实游戏换班验收。

## 生成排班方案

```http
POST /api/v1/arrange
Content-Type: application/json
```

## 请求

请求体沿用玩家数据中 `troop` 和 `building` 的原始 JSON 层级。调用方可以移除与排班无关的字段，无需提交完整玩家数据。

### 请求示例

```json
{
  "troop": {
    "chars": {
      "1": {
        "instId": 1,
        "charId": "char_002_amiya",
        "level": 80,
        "evolvePhase": 2
      },
      "2": {
        "instId": 2,
        "charId": "char_102_texas",
        "level": 50,
        "evolvePhase": 2
      }
    }
  },
  "building": {
    "chars": {
      "1": {
        "charId": "char_002_amiya",
        "ap": 3742935,
        "roomSlotId": "slot_34"
      },
      "2": {
        "charId": "char_102_texas",
        "ap": 8640000,
        "roomSlotId": "slot_14"
      }
    },
    "roomSlots": {
      "slot_14": {
        "level": 3,
        "state": 2,
        "roomId": "MANUFACTURE",
        "charInstIds": [2, -1, -1]
      },
      "slot_24": {
        "level": 3,
        "state": 2,
        "roomId": "TRADING",
        "charInstIds": [-1, -1, -1]
      }
    },
    "rooms": {
      "MANUFACTURE": {
        "slot_14": {
          "formulaId": "4",
          "capacity": 60
        }
      },
      "TRADING": {
        "slot_24": {
          "strategy": "O_GOLD",
          "stockLimit": 14,
          "stock": []
        }
      },
      "DORMITORY": {
        "slot_1": {
          "comfort": 5000
        }
      }
    }
  }
}
```

### 关键字段

#### 干员信息

| 字段路径 | 类型 | 说明 |
| --- | --- | --- |
| `troop.chars.*.instId` | integer | 干员实例 ID |
| `troop.chars.*.charId` | string | 干员数据 ID |
| `troop.chars.*.level` | integer | 干员等级 |
| `troop.chars.*.evolvePhase` | integer | 精英阶段 |
| `building.chars.*.charId` | string | 干员数据 ID |
| `building.chars.*.ap` | integer | 当前心情值，沿用游戏数据中的原始单位 |
| `building.chars.*.roomSlotId` | string | 当前所在房间；未进驻时为空字符串 |

`troop.chars` 与 `building.chars` 均以干员实例 ID 的字符串形式作为键。

#### 房间信息

| 字段路径 | 类型 | 说明 |
| --- | --- | --- |
| `building.roomSlots.*.level` | integer | 房间等级 |
| `building.roomSlots.*.state` | integer | 房间状态 |
| `building.roomSlots.*.roomId` | string | 房间类型 |
| `building.roomSlots.*.charInstIds` | integer[] | 当前进驻的干员实例 ID |
| `building.rooms.MANUFACTURE.*.formulaId` | string | 制造站当前配方 |
| `building.rooms.MANUFACTURE.*.capacity` | integer | 制造站容量 |
| `building.rooms.TRADING.*.strategy` | string | 贸易站当前订单类型 |
| `building.rooms.TRADING.*.stockLimit` | integer | 贸易站订单容量 |
| `building.rooms.TRADING.*.stock` | array | 贸易站当前订单 |
| `building.rooms.DORMITORY.*.comfort` | integer | 宿舍氛围值 |

常见房间类型包括：

- `CONTROL`
- `POWER`
- `MANUFACTURE`
- `TRADING`
- `DORMITORY`
- `MEETING`
- `HIRE`

请求中不需要包含账号身份、货币、仓库、招募、抽卡、任务、活动、社交、战斗或认证信息。

## 成功响应

排班结果位于 `data.arranged`，并按房间类型分组。

```json
{
  "data": {
    "arranged": {
      "Control": [],
      "Power": [],
      "Manufacture": [
        {
          "RoomType": 1,
          "Slot": "slot_14",
          "Level": 3,
          "CharNum": 3,
          "ExtraScore": 0,
          "RoomChar": [
            {
              "Char": "char_002_amiya",
              "ApCost": 1,
              "Inst": {
                "Ap": 3742935,
                "Inst": 1,
                "Ev": 2,
                "Lvl": 80,
                "Char": "char_002_amiya",
                "Buffs": []
              }
            },
            {
              "Char": "char_102_texas",
              "ApCost": 1,
              "Inst": {
                "Ap": 8640000,
                "Inst": 2,
                "Ev": 2,
                "Lvl": 50,
                "Char": "char_102_texas",
                "Buffs": []
              }
            }
          ],
          "Formula": "4",
          "ProdSpeed": 0,
          "Capacity": 0,
          "RawCap": 0
        }
      ],
      "Trading": [],
      "Dormitory": [],
      "Meeting": [],
      "Hire": []
    }
  }
}
```

### 排班结果关键字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `Slot` | string | 房间位置 ID |
| `Level` | integer | 房间等级 |
| `CharNum` | integer | 房间槽位数量 |
| `RoomChar` | array | 该房间的干员安排 |
| `RoomChar.*.Char` | string | 干员数据 ID |
| `RoomChar.*.Inst.Inst` | integer | 干员实例 ID |

当 `RoomChar` 数量少于 `CharNum` 时，剩余位置视为空位。

`RoomType` 的取值：

| 值 | 房间类型 |
| ---: | --- |
| `0` | 宿舍 |
| `1` | 制造站 |
| `2` | 贸易站 |
| `3` | 发电站 |
| `4` | 控制中枢 |
| `5` | 会客室 |
| `6` | 办公室 |

## 错误响应

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "请求中的基建数据无效"
  }
}
```

建议使用以下 HTTP 状态码：

| 状态码 | 说明 |
| ---: | --- |
| `400` | 请求格式或字段无效 |
| `422` | 无法生成有效排班方案 |
| `500` | 排班计算失败 |
| `503` | 排班服务暂时不可用 |
