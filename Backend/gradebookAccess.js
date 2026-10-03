function filterGradebooksForList(gradebooks, { includeArchived = false } = {}) {
  return (gradebooks || []).filter((gradebook) => includeArchived || gradebook.status === 'active');
}

module.exports = { filterGradebooksForList };
