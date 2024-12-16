fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Compile protobuf types
    tonic_build::compile_protos("../../proto/plugins/runtime.proto")?;

    Ok(())
}
