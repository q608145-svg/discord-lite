// Next.js instrumentation hook.
// Socket.IO и REST API подключаются отдельно — в server/index.js (npm run start),
// потому что dev-сервер Next.js не позволяет навесить на себя обработчики.
export async function register() {
  // no-op
}
