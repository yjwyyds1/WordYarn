cmake_minimum_required(VERSION 3.21)
project(wordyarn_desktop LANGUAGES C CXX)
if(NOT WIN32 OR NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 8)
  message(FATAL_ERROR "WordYarn desktop requires the MSVC x64 Windows toolchain.")
endif()
if(NOT VCPKG_TARGET_TRIPLET STREQUAL "x64-windows")
  message(FATAL_ERROR "Set VCPKG_TARGET_TRIPLET=x64-windows to package Windows dependencies.")
endif()

set(WEBVIEW2_SDK "" CACHE PATH "Extracted Microsoft.Web.WebView2 NuGet package")
set(WEBVIEW2_NATIVE "${WEBVIEW2_SDK}/build/native")
if(NOT EXISTS "${WEBVIEW2_NATIVE}/include/WebView2.h")
  message(FATAL_ERROR "Set WEBVIEW2_SDK to the extracted Microsoft.Web.WebView2 NuGet package.")
endif()

# This compiles the same study service as web/, avoiding duplicated database logic.
add_subdirectory(../web web-service)
find_package(unofficial-sqlite3 CONFIG REQUIRED)
add_executable(WordYarn WIN32 src/main.cpp src/migration.cpp)
target_compile_features(WordYarn PRIVATE cxx_std_17)
target_compile_options(WordYarn PRIVATE /utf-8)
target_compile_definitions(WordYarn PRIVATE UNICODE _UNICODE)
target_include_directories(WordYarn SYSTEM PRIVATE "${WEBVIEW2_NATIVE}/include")
target_link_libraries(WordYarn PRIVATE unofficial::sqlite3::sqlite3
  "${WEBVIEW2_NATIVE}/x64/WebView2Loader.dll.lib"
  user32 gdi32 shlwapi shell32 ole32 uuid version winhttp bcrypt ws2_32)

install(TARGETS WordYarn cet4 RUNTIME DESTINATION .)
install(FILES "${WEBVIEW2_NATIVE}/x64/WebView2Loader.dll" DESTINATION .)
if(DEFINED VCPKG_INSTALLED_DIR AND DEFINED VCPKG_TARGET_TRIPLET)
  # vcpkg's dynamic libraries must accompany the portable package.
  install(DIRECTORY "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/bin/"
    DESTINATION . FILES_MATCHING PATTERN "*.dll")
  install(DIRECTORY "${VCPKG_INSTALLED_DIR}/${VCPKG_TARGET_TRIPLET}/share/"
    DESTINATION licenses FILES_MATCHING PATTERN "copyright")
endif()
install(FILES "${WEBVIEW2_SDK}/LICENSE.txt" "${WEBVIEW2_SDK}/NOTICE.txt"
  DESTINATION licenses/webview2 OPTIONAL)
include(InstallRequiredSystemLibraries)
if(CMAKE_INSTALL_SYSTEM_RUNTIME_LIBS)
  install(FILES ${CMAKE_INSTALL_SYSTEM_RUNTIME_LIBS} DESTINATION .)
endif()
install(DIRECTORY ../web/site/ DESTINATION site
  PATTERN "_dev" EXCLUDE PATTERN "README.md" EXCLUDE PATTERN "*.map" EXCLUDE)
