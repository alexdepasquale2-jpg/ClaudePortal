#include <jni.h>

#include <mutex>
#include <string>
#include <vector>

#include "llama.h"

namespace {

std::mutex g_mu;
llama_model * g_model = nullptr;
std::string g_path;

std::string clean_utf8(const std::string & in) {
    std::string out;
    out.reserve(in.size());
    for (size_t i = 0; i < in.size();) {
        unsigned char c = static_cast<unsigned char>(in[i]);
        size_t need = 1;
        if ((c & 0x80) == 0) need = 1;
        else if ((c & 0xE0) == 0xC0) need = 2;
        else if ((c & 0xF0) == 0xE0) need = 3;
        else if ((c & 0xF8) == 0xF0) need = 4;
        else { i++; continue; }
        if (i + need > in.size()) break;
        bool ok = true;
        for (size_t k = 1; k < need; k++) {
            if ((static_cast<unsigned char>(in[i + k]) & 0xC0) != 0x80) ok = false;
        }
        if (!ok) { i++; continue; }
        out.append(in, i, need);
        i += need;
    }
    return out;
}

std::string piece_of(const llama_vocab * vocab, llama_token token) {
    char buf[256];
    int n = llama_token_to_piece(vocab, token, buf, sizeof(buf), 0, true);
    if (n < 0) {
        std::string bigger(static_cast<size_t>(-n), '\0');
        n = llama_token_to_piece(vocab, token, bigger.data(), static_cast<int>(bigger.size()), 0, true);
        if (n > 0) return std::string(bigger.data(), static_cast<size_t>(n));
        return {};
    }
    if (n > 0) return std::string(buf, static_cast<size_t>(n));
    return {};
}

std::string run(const std::string & path, const std::string & prompt, int max_tokens) {
    std::lock_guard<std::mutex> lock(g_mu);
    if (max_tokens < 1) max_tokens = 1;
    if (max_tokens > 128) max_tokens = 128;
    if (path.empty()) return "model: weights path is empty";

    llama_backend_init();
    if (g_model == nullptr || g_path != path) {
        if (g_model) {
            llama_model_free(g_model);
            g_model = nullptr;
        }
        auto params = llama_model_default_params();
        params.n_gpu_layers = 0;
        g_model = llama_model_load_from_file(path.c_str(), params);
        if (!g_model) return "model: could not load " + path;
        g_path = path;
    }

    const llama_vocab * vocab = llama_model_get_vocab(g_model);
    std::vector<llama_token> tokens(prompt.size() + 16);
    int n = llama_tokenize(vocab, prompt.c_str(), static_cast<int>(prompt.size()),
                            tokens.data(), static_cast<int>(tokens.size()), true, true);
    if (n < 0) {
        tokens.resize(static_cast<size_t>(-n));
        n = llama_tokenize(vocab, prompt.c_str(), static_cast<int>(prompt.size()),
                            tokens.data(), static_cast<int>(tokens.size()), true, true);
    }
    if (n <= 0) return "model: could not tokenize the prompt";
    tokens.resize(static_cast<size_t>(n));

    auto cparams = llama_context_default_params();
    cparams.n_ctx = 256;
    cparams.n_batch = 128;
    cparams.n_ubatch = 128;
    cparams.n_threads = 4;
    cparams.n_threads_batch = 4;
    llama_context * ctx = llama_init_from_model(g_model, cparams);
    if (!ctx) return "model: could not create a context";

    llama_batch batch = llama_batch_get_one(tokens.data(), n);
    if (llama_decode(ctx, batch) != 0) {
        llama_free(ctx);
        return "model: the first decode failed";
    }

    auto sparams = llama_sampler_chain_default_params();
    llama_sampler * smpl = llama_sampler_chain_init(sparams);
    llama_sampler_chain_add(smpl, llama_sampler_init_greedy());

    std::string out;
    for (int i = 0; i < max_tokens; i++) {
        llama_token tok = llama_sampler_sample(smpl, ctx, -1);
        if (llama_vocab_is_eog(vocab, tok)) break;
        out += piece_of(vocab, tok);
        llama_batch next = llama_batch_get_one(&tok, 1);
        if (llama_decode(ctx, next) != 0) break;
    }

    llama_sampler_free(smpl);
    llama_free(ctx);
    out = clean_utf8(out);
    if (out.empty()) return "model: no tokens";
    return out;
}

}  // namespace

extern "C" JNIEXPORT jstring JNICALL
Java_org_xindoze_bridge_Llama_complete(
    JNIEnv * env, jclass, jstring jpath, jstring jprompt, jint max_tokens) {
    const char * path = jpath ? env->GetStringUTFChars(jpath, nullptr) : "";
    const char * prompt = jprompt ? env->GetStringUTFChars(jprompt, nullptr) : "";
    std::string result = run(path ? path : "", prompt ? prompt : "", static_cast<int>(max_tokens));
    if (jpath && path) env->ReleaseStringUTFChars(jpath, path);
    if (jprompt && prompt) env->ReleaseStringUTFChars(jprompt, prompt);
    return env->NewStringUTF(result.c_str());
}
