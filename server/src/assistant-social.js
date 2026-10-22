// Social replies are separate from ledger queries and commands.
// Whole-utterance matching prevents a greeting from swallowing a business request.
const businessChoices = Object.freeze(['号卡', '充值', '宽带', '套餐', '购机', '维修']);
const businessFollowups = Object.freeze([
  { label: '办号卡', question: '我想办张手机卡' },
  { label: '充值', question: '我来办充值业务' },
  { label: '宽带', question: '装宽带怎么办理' },
  { label: '套餐', question: '套餐怎么变更' },
  { label: '买手机', question: '我想买手机，帮我了解选购建议' },
  { label: '维修', question: '手机维修怎么登记' },
]);
const punctuation = /[\s，,。.!！?？～~、：:;；“”‘’"']/g;
const greetingWord = '(?:你好|您好|嗨|哈喽|hello|hi|早上好|上午好|中午好|下午好|晚上好)';
const greetingOnly = new RegExp(`^(?:喂|哎)?(?:${greetingWord})(?:呀|啊|哇|嘛)?$`, 'i');
const greetingPrefix = new RegExp(`^(?:喂|哎)?${greetingWord}(?:呀|啊|哇|嘛)?`, 'i');
const tail = '[啊呀呢嘛哇哦哈]{0,2}';
const pattern = (source) => new RegExp(`^(?:${source})${tail}$`, 'i');
const arrival = pattern('(?:有)?(?:顾客|客人|客户)(?:来(?:了)?|到(?:了)?|到店(?:了)?|进店(?:了)?)|来(?:了)?(?:个|一个)(?:顾客|客人|客户)|有人来了|开始接待|迎宾|欢迎顾客');
const working = pattern('(?:你)?(?:现在|这会儿)?(?:在干吗|在干嘛|在干什么|在做什么|在忙什么|在忙啥子|在做啥子|在做啥|在干啥|忙啥子|干啥子|干啥|忙不忙|有空吗)');
const capabilities = pattern('(?:你)?(?:能|可以|会|会不会|能不能)(?:帮我|帮我们|帮顾客)?(?:干什么|做什么|干点什么|做点什么|干啥子|做啥子|干啥|做啥|办业务|办理业务|办事)(?:吗|不)?|(?:你)?(?:有什么本事|有啥子本事|有什么用|有啥子用|有哪些功能|有什么功能)');
const identity = pattern('(?:你)?(?:是谁|是什么人|是什么机器人|是什么助理)|(?:你)?(?:是哪里的人|是哪里人|是哪儿的人|是哪儿人|是哪的人|来自哪里|来自哪儿|是哪里来的|是哪儿来的|是哪里(?:的)?|是哪儿(?:的)?)|(?:你)?(?:是不是|是)(?:重庆|云阳)(?:妹儿|妹子|妹妹|人)(?:吗|不)?|(?:你)?(?:是不是|是)南溪(?:街上|镇上)?(?:的)?(?:人|妹儿|妹子)?(?:吗|不)?');
const employer = pattern('(?:你)?(?:老板是谁|老板是哪个|老板叫什么|帮谁干|帮哪个干|给谁干活|给哪个干活|为谁服务|为哪个服务|替谁工作|替哪个工作|是给谁干的|是谁的助理)');
const genericBusiness = pattern('(?:我|我们)?(?:来|想来|要|想|想要)?(?:办|办理|咨询)(?:一下|个|一个|一项|点|一点)?业务(?:可以吗|行吗|要得不)?|(?:请|麻烦你|帮我|帮我们|给我)(?:办|办理|咨询)(?:一下|个|一个|一项)?业务(?:可以吗|行吗|要得不)?');
const rechargeEntry = pattern('(?:我|我们)?(?:来|想|要)?办(?:理)?充值业务|(?:手机|话费)?充值业务怎么登记|(?:手机|话费)?充值业务(?:在哪|在哪里)(?:登记|办|办理)');
const repairEntry = pattern('(?:手机)?维修(?:接待)?怎么登记|(?:我|我们)?(?:来|想|要)?办(?:理)?维修业务|维修(?:接待)?(?:在哪|在哪里)(?:登记|办|办理)');

function query(store, user, question, options = {}) {
  if (typeof question !== 'string' || !question.trim() || question.length > 240) return null;
  const compact = question.replace(punctuation, '');
  const replyStyle = options.customerReplyStyle === 'mandarin' ? 'mandarin' : 'sichuan';
  const reply = (topic, sichuan, mandarin, extra = {}) => ({
    answer: replyStyle === 'mandarin' ? mandarin : sichuan,
    sources: [],
    metrics: { kind: 'assistant-social', replyStyle, topic },
    ...extra,
  });
  if (greetingOnly.test(compact) || arrival.test(compact) || /^(?:喂|在吗|在不在|有人吗|有人在吗|听得到吗)$/.test(compact)) {
    return reply('greeting', '你好嘛，要我帮你做点啥子？', '您好，需要我帮您做什么？', {
      conversationHint: { topic: 'business-choice', choices: [...businessChoices] },
      followups: [],
    });
  }
  let remaining = compact;
  for (let count = 0; count < 2 && greetingPrefix.test(remaining); count++) remaining = remaining.replace(greetingPrefix, '');
  remaining = remaining.replace(/^(?:喂|哎|那个|嗯){1,3}/, '');
  if (working.test(remaining)) {
    return reply('working', '我在这儿给门店帮忙哈。查资料、选商品、理单子，你说一声嘛。', '我在为门店提供帮助。可以查资料、选商品、整理单据，您需要什么？');
  }
  if (capabilities.test(remaining)) {
    return reply('capabilities', '会帮忙哈！我能查库存、找商品、查业务资料，帮你填单子。办啥子业务你说嘛，最后由店员核对确认。', '我能查询库存、查找商品和业务资料，帮助填写单据。您想办什么业务？最后由店员核对确认。');
  }
  if (identity.test(remaining)) {
    return reply('identity', '我是这家门店的数字助理，不是真人妹儿哈。川渝话我可以跟你摆，也能帮你查资料、选商品。', '我是这家门店的数字助理，不是真人，没有籍贯或实际住址。我可以帮您查资料、选商品。');
  }
  if (employer.test(remaining)) {
    return reply('employer', '我给这家门店帮忙哈，帮老板和店员查资料、理单子，也给顾客答疑。', '我为这家门店服务，帮助老板和店员查询资料、整理单据，也为顾客答疑。');
  }
  if (genericBusiness.test(remaining)) {
    return reply('business-choice', '要得嘛！你要办号卡、充值、宽带、套餐，还是买手机、维修？', '可以。您要办理号卡、充值、宽带、套餐，还是购机、维修？', {
      conversationHint: { topic: 'business-choice', choices: [...businessChoices] },
      followups: businessFollowups.map((row) => ({ ...row })),
    });
  }
  if (rechargeEntry.test(remaining)) {
    return reply('recharge-entry', '要得，先登记充值业务哈。手机号、金额由店员核对；登记单子不等于已经充值或收款。', '可以先登记充值业务。手机号和金额由店员核对；登记不等于已经充值或收款。', {
      sources: [{ label: '移动业务登记', id: 'recharge-entry', href: '/carrier' }],
      action: { type: 'navigate', label: '登记充值业务', href: '/carrier' },
    });
  }
  if (repairEntry.test(remaining)) {
    return reply('repair-entry', '可以先登记维修接待哈。手机哪里不对劲、怎么联系你，店员检查后再确认维修。', '可以先登记维修接待，记录手机故障和联系方式，店员检查后再确认维修。', {
      sources: [{ label: '客户接待登记', id: 'repair-entry', href: '/receptions' }],
      action: { type: 'navigate', label: '登记维修接待', href: '/receptions', prefill: { purpose: '维修' } },
    });
  }
  return null;
}

module.exports = { query };

