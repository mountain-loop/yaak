//! Workspace encryption keys and the `secure()` template function.

use crate::error::Result;
use crate::host::{Host, PluginHost};
use yaak_plugins::native_template_functions::decrypt_secure_template_function;
use yaak_rpc_schema::*;

pub async fn cmd_enable_encryption<H: Host>(host: H, req: CmdEnableEncryptionReq) -> Result<()> {
    host.encryption_manager().ensure_workspace_key(&req.workspace_id)?;
    host.encryption_manager().reveal_workspace_key(&req.workspace_id)?;
    Ok(())
}

pub async fn cmd_reveal_workspace_key<H: Host>(
    host: H,
    req: CmdRevealWorkspaceKeyReq,
) -> Result<String> {
    Ok(host.encryption_manager().reveal_workspace_key(&req.workspace_id)?)
}

pub async fn cmd_set_workspace_key<H: Host>(host: H, req: CmdSetWorkspaceKeyReq) -> Result<()> {
    host.encryption_manager().set_human_key(&req.workspace_id, &req.key)?;
    Ok(())
}

pub async fn cmd_disable_encryption<H: Host>(host: H, req: CmdDisableEncryptionReq) -> Result<()> {
    host.encryption_manager().disable_encryption(&req.workspace_id)?;
    Ok(())
}

pub async fn cmd_decrypt_template<H: Host>(host: H, req: CmdDecryptTemplateReq) -> Result<String> {
    let plugin_context = host.plugin_context();
    Ok(decrypt_secure_template_function(host.encryption_manager(), &plugin_context, &req.template)?)
}

pub async fn cmd_secure_template<H: PluginHost>(
    host: H,
    req: CmdSecureTemplateReq,
) -> Result<String> {
    host.encrypt_secure_template(&req.template).await
}
