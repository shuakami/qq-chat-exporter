pub mod batch_fetcher;
pub mod chat_type;
pub mod sequence_integrity;

pub use batch_fetcher::{
    ApiCallStats, BatchFetchConfig, BatchFetchResult, BatchMessageFetcher, FetchError,
    FetchStrategy, MessageFetchApi, MessageFilter, MessageTypeFilter, Peer,
};
pub use chat_type::{
    chat_type_prefix, classify_chat_type_binary, is_private_like_chat_type, GROUP_CHAT_TYPE,
};

pub use sequence_integrity::{
    repair_group_message_sequence, SequenceRepairConfig, SequenceRepairReport,
};
