# ============================================================
#  BOT — 本地 Whisper 语音识别服务
#  提供 OpenAI 兼容的 /v1/audio/transcriptions 接口
#  完全离线运行，支持中文识别
# ============================================================
# 安装依赖：
#   pip install faster-whisper fastapi uvicorn python-multipart
#
# 启动服务：
#   python local_whisper_server.py
#
# 然后在 BOT设置中配置：
#   STT API 地址：http://localhost:8000/v1/audio/transcriptions
#   STT API Key：任意填写（如 local）
#   模型：base 或 small（根据电脑性能选择）
#   语言：zh
# ============================================================

import os
import sys
import tempfile
import argparse
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# 全局模型变量（懒加载）
_model = None
_model_name = None

def load_model(model_name: str):
    """加载 Whisper 模型（懒加载，首次调用时加载）"""
    global _model, _model_name
    if _model is not None and _model_name == model_name:
        return _model

    print(f"[Whisper] 正在加载模型: {model_name} ...")
    try:
        from faster_whisper import WhisperModel
        # 自动选择设备（有 GPU 用 GPU，否则用 CPU）
        try:
            import torch
            device = "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            device = "cpu"

        compute_type = "float16" if device == "cuda" else "int8"
        print(f"[Whisper] 使用设备: {device}, 计算类型: {compute_type}")

        _model = WhisperModel(model_name, device=device, compute_type=compute_type)
        _model_name = model_name
        print(f"[Whisper] 模型加载完成: {model_name}")
        return _model
    except ImportError:
        print("[错误] 未安装 faster-whisper，请运行: pip install faster-whisper")
        sys.exit(1)
    except Exception as e:
        print(f"[错误] 模型加载失败: {e}")
        sys.exit(1)


app = FastAPI(title="Bot Local Whisper STT", version="1.0.0")

# 允许跨域（Electron 应用需要）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
async def root():
    return {
        "service": "Bot Local Whisper STT",
        "status": "running",
        "endpoints": {
            "transcriptions": "/v1/audio/transcriptions",
            "health": "/health",
        }
    }


@app.get("/health")
async def health():
    return {"status": "ok", "model": _model_name or "not loaded"}


@app.post("/v1/audio/transcriptions")
async def transcribe(
    file: UploadFile = File(...),
    model: str = Form("base"),
    language: str = Form("zh"),
    response_format: str = Form("json"),
):
    """OpenAI 兼容的语音转文字接口"""
    try:
        # 读取上传的音频文件
        audio_data = await file.read()
        if not audio_data or len(audio_data) < 1000:
            raise HTTPException(status_code=400, detail="音频数据过小，可能没有声音")

        # 保存到临时文件
        suffix = os.path.splitext(file.filename or "audio.webm")[1] or ".webm"
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_data)
            tmp_path = tmp.name

        try:
            # 加载模型
            whisper_model = load_model(model)

            # 执行识别
            print(f"[Whisper] 开始识别，语言: {language}, 音频大小: {len(audio_data)} 字节")
            segments, info = whisper_model.transcribe(
                tmp_path,
                language=language if language != "zh" else "zh",
                beam_size=5,
                vad_filter=True,  # 启用语音活动检测，过滤静音
                vad_parameters=dict(min_silence_duration_ms=500),
            )

            # 收集识别结果
            text_parts = []
            for segment in segments:
                text_parts.append(segment.text.strip())

            full_text = "".join(text_parts).strip()
            print(f"[Whisper] 识别完成: {full_text[:80]}{'...' if len(full_text) > 80 else ''}")

            if response_format == "text":
                return full_text

            return {
                "text": full_text,
                "language": info.language,
                "duration": info.duration,
            }

        finally:
            # 清理临时文件
            try:
                os.unlink(tmp_path)
            except:
                pass

    except HTTPException:
        raise
    except Exception as e:
        print(f"[错误] 识别失败: {e}")
        raise HTTPException(status_code=500, detail=f"识别失败: {str(e)}")


def main():
    parser = argparse.ArgumentParser(description="BOT 本地 Whisper 语音识别服务")
    parser.add_argument("--host", default="127.0.0.1", help="监听地址（默认 127.0.0.1）")
    parser.add_argument("--port", type=int, default=8000, help="监听端口（默认 8000）")
    parser.add_argument("--model", default="base", help="默认模型（tiny/base/small/medium/large-v3）")
    args = parser.parse_args()

    print("=" * 60)
    print("  BOT — 本地 Whisper 语音识别服务")
    print("=" * 60)
    print(f"  监听地址: http://{args.host}:{args.port}")
    print(f"  API 地址: http://{args.host}:{args.port}/v1/audio/transcriptions")
    print(f"  默认模型: {args.model}")
    print("=" * 60)
    print()
    print("  在 BOT设置中配置：")
    print(f"    STT API 地址：http://{args.host}:{args.port}/v1/audio/transcriptions")
    print("    STT API Key：local（任意填写）")
    print(f"    模型：{args.model}")
    print("    语言：zh")
    print()
    print("  按 Ctrl+C 停止服务")
    print("=" * 60)
    print()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
