cmake_minimum_required(VERSION 3.22.1)
project(xindoze_llama)

if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/CMakeLists.txt")
    message(FATAL_ERROR "llama.cpp checkout is missing next to this CMakeLists.txt")
endif()

set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

add_subdirectory(llama.cpp)

add_library(xindoze_llama SHARED jni_llama.cpp)
target_link_libraries(xindoze_llama llama android log)
target_include_directories(xindoze_llama PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/llama.cpp/ggml/include")
