#pragma once
#include <filesystem>

namespace wordyarn {
// Copies a consistent database snapshot, including committed WAL pages.
// Returns false when there is nothing to import or a destination already exists.
bool migrate(const std::filesystem::path& source, const std::filesystem::path& target);
}
