"""Writes a tiny random-weight llama GGUF (byte-fallback SPM vocab) for plumbing tests.

Usage: pip install gguf numpy; python tiny_gguf.py /tmp/tiny.gguf
Then: XZ_TEST_GGUF=/tmp/tiny.gguf cargo test -p xz-cortex --features llamacpp -- --ignored
"""
import sys
import numpy as np
import gguf

out = sys.argv[1]
rng = np.random.default_rng(0)
n_embd, n_head, n_layer, n_ff, n_ctx = 64, 4, 2, 128, 2048

tokens = [b"<unk>", b"<s>", b"</s>"] + [f"<0x{i:02X}>".encode() for i in range(256)]
types = [gguf.TokenType.UNKNOWN, gguf.TokenType.CONTROL, gguf.TokenType.CONTROL] + [gguf.TokenType.BYTE] * 256
extra = ["▁", "{", "}", "\"", ":", ",", "true", "false", "ok", "n", "▁the", "hello", "0", "1"]
tokens += [t.encode() for t in extra]
types += [gguf.TokenType.NORMAL] * len(extra)
scores = [0.0] * len(tokens)
n_vocab = len(tokens)

w = gguf.GGUFWriter(out, "llama")
w.add_name("xz-tiny-random")
w.add_context_length(n_ctx)
w.add_embedding_length(n_embd)
w.add_block_count(n_layer)
w.add_feed_forward_length(n_ff)
w.add_head_count(n_head)
w.add_head_count_kv(n_head)
w.add_rope_dimension_count(n_embd // n_head)
w.add_layer_norm_rms_eps(1e-5)
w.add_vocab_size(n_vocab)
w.add_tokenizer_model("llama")
w.add_token_list(tokens)
w.add_token_scores(scores)
w.add_token_types(types)
w.add_bos_token_id(1)
w.add_eos_token_id(2)
w.add_unk_token_id(0)
w.add_add_bos_token(True)
w.add_chat_template("{% for m in messages %}<|im_start|>{{ m['role'] }}\n{{ m['content'] }}<|im_end|>\n{% endfor %}<|im_start|>assistant\n")

def t(name, *shape):
    w.add_tensor(name, (rng.standard_normal(shape) * 0.02).astype(np.float32))

t("token_embd.weight", n_vocab, n_embd)
w.add_tensor("output_norm.weight", np.ones(n_embd, dtype=np.float32))
t("output.weight", n_vocab, n_embd)
for i in range(n_layer):
    w.add_tensor(f"blk.{i}.attn_norm.weight", np.ones(n_embd, dtype=np.float32))
    w.add_tensor(f"blk.{i}.ffn_norm.weight", np.ones(n_embd, dtype=np.float32))
    for n in ("attn_q", "attn_k", "attn_v", "attn_output"):
        t(f"blk.{i}.{n}.weight", n_embd, n_embd)
    t(f"blk.{i}.ffn_gate.weight", n_ff, n_embd)
    t(f"blk.{i}.ffn_up.weight", n_ff, n_embd)
    t(f"blk.{i}.ffn_down.weight", n_embd, n_ff)

w.write_header_to_file()
w.write_kv_data_to_file()
w.write_tensors_to_file()
w.close()
print(out, n_vocab)
