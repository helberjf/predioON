import { ApiError } from "@predioon/api-client";

function validUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index++;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
}

/** Keep passwords literal: spaces and Unicode are part of the credential. */
export function passwordChangeValidation(currentPassword: string, newPassword: string, confirmation: string): string | null {
  if (![newPassword, confirmation].every(validUnicode)) return "Informe uma nova senha com caracteres Unicode válidos.";
  if (!currentPassword) return "Informe sua senha atual.";
  if (new TextEncoder().encode(currentPassword).length > 1024) return "A senha atual ultrapassa o limite de 1024 bytes.";
  if (Array.from(newPassword).length < 15) return "A nova senha precisa ter pelo menos 15 caracteres.";
  if (new TextEncoder().encode(newPassword).length > 1024) return "A nova senha ultrapassa o limite de 1024 bytes. Use uma senha menor.";
  if (newPassword === currentPassword) return "Escolha uma senha diferente da senha atual.";
  if (newPassword !== confirmation) return "A confirmação precisa ser igual à nova senha.";
  return null;
}

/** Only fixed messages reach the form; a response must never echo a password. */
export function passwordChangeError(error: unknown): string | null {
  if (error instanceof ApiError && error.code === "SESSION_CHANGED") return null;
  if (error instanceof ApiError && error.status === 400) return "Não foi possível alterar a senha. Confira a senha atual e os requisitos da nova senha.";
  if (error instanceof ApiError && error.status === 429) return "Você tentou alterar a senha muitas vezes. Aguarde antes de tentar novamente.";
  return "Não foi possível confirmar a troca de senha. Tente novamente; se já tiver sido alterada, entre com a nova senha.";
}
