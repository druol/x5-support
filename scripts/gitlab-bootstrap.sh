#!/usr/bin/env bash
# Идемпотентная инициализация GitLab: гарантирует root-админа и закрывает регистрацию.
# Запускать после того, как контейнер orbita-gitlab стал healthy:
#   ./scripts/gitlab-bootstrap.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

PASSWORD="${GITLAB_ROOT_PASSWORD:-change-me-before-use}"

if ! docker inspect orbita-gitlab >/dev/null 2>&1; then
  echo "Контейнер orbita-gitlab не найден. Сначала: make gitlab"
  exit 1
fi

docker exec orbita-gitlab gitlab-rails runner "
u = User.find_by_username('root')
if u.nil?
  u = Users::CreateService.new(nil, {
    username: 'root',
    email: 'root@orbita.local',
    name: 'Administrator',
    password: '${PASSWORD}',
    password_confirmation: '${PASSWORD}'
  }).execute
end
if u&.persisted?
  u.admin = true
  u.save!
  puts 'root: admin ready'
else
  puts 'root: ' + (u&.errors&.full_messages&.inspect || 'not created')
end

begin
  ApplicationSetting.current.update!(signup_enabled: false)
  puts 'signup: disabled'
rescue => e
  puts 'signup: ' + e.message
end
" 2>&1 | grep -E 'root:|signup:' || true
