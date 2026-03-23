exports.handler = async (event) => {
  const payload = JSON.parse(event.body || '{}');
  const user = payload.user || {};
  const appMetadata = user.app_metadata || {};
  const roles = Array.isArray(appMetadata.roles) ? appMetadata.roles : [];

  if (!roles.includes('admin_user')) {
    roles.push('admin_user');
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      app_metadata: {
        ...appMetadata,
        roles,
      },
    }),
  };
};
