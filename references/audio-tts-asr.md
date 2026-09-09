# TTS / ASR — 语音合成与识别

SDK：`coze-coding-dev-sdk`，仅后端使用。

## TTS（文本转语音）

### API 签名

```typescript
import { TTSClient, Config } from 'coze-coding-dev-sdk';

const client = new TTSClient();
const result = await client.synthesize({
  uid: 'user-001',                       // 必填，稳定的用户标识
  text: 'Welcome to Coze Studio!',       // 与 ssml 二选一
  // ssml: '<speak>...</speak>',         // 高级控制（停顿、多音字、数字读法）
  speaker: 'zh_female_xiaohe_uranus_bigtts', // 默认音色
  audioFormat: 'mp3',                    // 'mp3' | 'pcm' | 'ogg_opus'
  sampleRate: 24000,                     // 8000-48000，默认 24000
  speechRate: 0,                         // 语速 [-50, 100]
  loudnessRate: 0,                       // 音量 [-50, 100]
});

result.audioUri;   // 音频 URI（对象存储，可直接访问/下载）
result.audioSize;  // 音频字节数
```

错误处理：SDK 失败时抛出异常（如参数缺失、语速越界、超长文本、上游失败），用 `try/catch` 包裹并读取 `err.message`；不要依赖返回值里的 error 字段。

SSML 示例：

```typescript
const result = await client.synthesize({
  uid: 'user-001',
  ssml: `<speak>欢迎<break time="500ms"/>来到豆包平台！</speak>`,
  speaker: 'zh_female_xiaohe_uranus_bigtts',
  audioFormat: 'mp3',
});
```

### 音色清单（按语言与音色类别）

**中文女声**：zh_female_xiaohe_uranus_bigtts（默认）、zh_female_cancan_mars_bigtts、zh_female_linjialin_uranus_bigtts、zh_female_qingxin_uranus_bigtts、zh_female_roumei_uranus_bigtts、zh_female_liaomei_uranus_bigtts、zh_female_shuangkuai_mars_bigtts、zh_female_wanwanxiaosuna_mars_bigtts、zh_female_dongfanghaoran_moon_bigtts、zh_female_beijingxiaoye_4_v2_mars_bigtts、zh_female_shaoergushi_mars_bigtts、zh_female_peiyin_nvhai_mars_bigtts

**中文男声**：zh_male_yuanqixiaosheng_moon_bigtts、zh_male_jingqiangkanye_moon_bigtts、zh_male_chunhou_mars_bigtts、zh_male_jinakangxiji_moon_bigtts、zh_male_beijingxiaoye_4_v2_mars_bigtts、zh_male_lvyin23_earth_161220_mars_bigtts、zh_male_rap_star_01_lipei_v2_mars_bigtts、zh_male_xinlingxiaoyuandi_mars_bigtts、zh_male_beijingxiaoye_4_v2_mars_bigtts

**多语言**：multi_female_wanqudashu_moon_bigtts、multi_male_jingqiangge_moon_bigtts、multi_female_gaolengyumei_moon_bigtts、multi_male_lijianren_moon_bigtts、multi_male_wanjieren_moon_bigtts、multi_female_shaonv_moon_bigtts

**粤语**：zh_female_cantonese_inclusive_v2_mars_bigtts、zh_male_cantonese_formal_v2_mars_bigtts、zh_male_cantonese_lively_v2_mars_bigtts

**英语**：en_female_sarah_venice_lately_v2_mars_bigtts、en_male_marcus_warm_lately_v2_mars_bigtts、en_male_narrator_brief_venice_v2_mars_bigtts

选型建议：客服/助手→默认小何；故事/儿童内容→zh_female_shaoergushi_mars_bigtts；广告口播→zh_male_jingqiangkanye_moon_bigtts；多语种内容→multi_* 系列。

## ASR（语音识别）

### API 签名

```typescript
import { ASRClient, Config } from 'coze-coding-dev-sdk';

const client = new ASRClient();
const result = await client.recognize({
  uid: 'user-001',   // 可选
  url: 'https://example.com/audio.mp3', // 与 base64Data 二选一
  // base64Data: '<base64 编码的音频>',
});

result.text;       // 完整识别文本
result.duration;   // 音频时长（毫秒）
result.utterances; // 分段结果 [{ beginTime, endTime, text, ... }]
result.rawData;    // 原始响应
```

### 约束

- 音频格式：WAV、MP3、OGG_OPUS、M4A；最长 2 小时，最大 100MB
- `url` 与 `base64Data` 二选一；base64 适合小文件，大文件用 URL
- 用户上传的音频先转存对象存储再传 URL

## TTS → ASR 流水线（校验合成质量）

```typescript
const tts = new TTSClient();
const asr = new ASRClient();

const spoken = await tts.synthesize({ uid: uid, text: '测试文本', audioFormat: 'mp3' });
const check = await asr.recognize({ url: spoken.audioUri });
if (check.text !== '测试文本') throw new Error('TTS 质量校验未通过');
```

## 注意事项

- `uid` 是计费/限流维度，同一会话保持一致。
- 在 Next.js 等会话型后端中，建议透传用户身份头：`new TTSClient(config, HeaderUtils.extractForwardHeaders(request.headers))`（SDK >= 0.7.10）。
- 语速/音量调整幅度建议每次 ±20 以内，过大易出现机械感。
- 修改脚本或参数后先用短文本（< 20 字）实测，再放量。
