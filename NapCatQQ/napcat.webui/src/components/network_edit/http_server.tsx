import GenericForm from './generic_form'
import type { Field } from './generic_form'

export interface HTTPServerFormProps {
  data?: OneBotConfig['network']['httpServers'][0]
  onClose: () => void
  onSubmit: (data: OneBotConfig['network']['httpServers'][0]) => Promise<void>
}

type HTTPServerFormType = OneBotConfig['network']['httpServers']

const HTTPServerForm: React.FC<HTTPServerFormProps> = ({
  data,
  onClose,
  onSubmit
}) => {
  const defaultValues: HTTPServerFormType[0] = {
    enable: false,
    name: '',
    host: '0.0.0.0',
    port: 3000,
    enableCors: true,
    enableWebsocket: true,
    messagePostFormat: 'array',
    token: '',
    debug: false
  }

  const fields: Field<'httpServers'>[] = [
    {
      name: 'enable',
      label: '启用',
      type: 'switch',
      description: '保存后启用此配置',
      colSpan: 1
    },
    {
      name: 'debug',
      label: '开启Debug',
      type: 'switch',
      description: '是否开启调试模式',
      colSpan: 1
    },
    {
      name: 'name',
      label: '名称',
      type: 'input',
      placeholder: '请输入名称',
      isRequired: true,
      isDisabled: !!data
    },
    {
      name: 'host',
      label: 'Host',
      type: 'input',
      placeholder: '请输入主机地址',
      isRequired: true
    },
    {
      name: 'port',
      label: 'Port',
      type: 'input',
      placeholder: '请输入端口',
      isRequired: true
    },
    {
      name: 'enableCors',
      label: '启用CORS',
      type: 'switch',
      description: '是否启用CORS跨域',
      colSpan: 1
    },
    {
      name: 'enableWebsocket',
      label: '启用Websocket',
      type: 'switch',
      description: '是否启用Websocket',
      colSpan: 1
    },
    {
      name: 'messagePostFormat',
      label: '消息格式',
      type: 'select',
      placeholder: '请选择消息格式',
      isRequired: true,
      options: [
        { key: 'array', value: 'Array' },
        { key: 'string', value: 'String' }
      ]
    },
    {
      name: 'token',
      label: 'Token',
      type: 'input',
      placeholder: '请输入Token'
    }
  ]

  return (
    <GenericForm
      data={data}
      defaultValues={defaultValues}
      onClose={onClose}
      onSubmit={onSubmit}
      fields={fields}
    />
  )
}

export default HTTPServerForm
