"""各担当エージェントの共通部。専用の役割(system)とツールだけを持つ Claude のツール実行ループ。"""
import base64
import json
import os
import threading

MODEL = os.environ.get("LYRICLEARN_MODEL", "claude-opus-5-5")
MAX_MESSAGES = 80


def image_block(data: bytes, media_type: str = "image/jpeg") -> dict:
    return {"type": "image", "source": {"type": "base64", "media_type": media_type,
                                        "data": base64.standard_b64encode(data).decode()}}


class AgentBase:
    def __init__(self, name: str, system: str, tools: list[dict], handlers: dict, client=None,
                 server_tools: list[dict] | None = None, max_turns: int = 12, max_tokens: int = 4096):
        if client is None:
            import anthropic
            client = anthropic.Anthropic()
        self.name, self.system, self.client = name, system, client
        self.tools = tools + (server_tools or [])
        self.handlers, self.max_turns, self.max_tokens = handlers, max_turns, max_tokens
        self.messages: list[dict] = []
        self.lock = threading.Lock()   # パイプライン実行中にユーザーが話しかけても直列化する

    def _call(self, name: str, args: dict) -> tuple[object, bool]:
        try:
            out = self.handlers[name](**args)
        except Exception as e:
            return f"{type(e).__name__}: {e}", True
        if isinstance(out, list):      # テキスト+画像などのブロック列はそのまま返す
            return out, False
        return json.dumps(out, ensure_ascii=False, default=str), False

    def chat(self, text: str) -> str:
        """発言/依頼を受け、ツールを回して最終の返信テキストを返す。"""
        with self.lock:
            if len(self.messages) > MAX_MESSAGES:
                self.messages = []
            self.messages.append({"role": "user", "content": text})
            for _ in range(self.max_turns):
                r = self.client.messages.create(model=MODEL, max_tokens=self.max_tokens, system=self.system,
                                                tools=self.tools, messages=self.messages)
                self.messages.append({"role": "assistant", "content": r.content})  # thinking含め丸ごと戻す
                if r.stop_reason == "refusal":
                    return "(この依頼には応答できませんでした)"
                if r.stop_reason == "pause_turn":      # サーバーツール(web検索)の長い処理を続行
                    continue
                uses = [b for b in r.content if b.type == "tool_use"]
                if r.stop_reason != "tool_use" or not uses:
                    return "".join(b.text for b in r.content if b.type == "text").strip()
                results = []
                for b in uses:
                    out, err = self._call(b.name, b.input)
                    results.append({"type": "tool_result", "tool_use_id": b.id, "content": out, "is_error": err})
                self.messages.append({"role": "user", "content": results})
            return f"({self.name}: ツール呼び出しが多すぎたため中断しました)"
