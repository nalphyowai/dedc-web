'use strict';

(function () {
  function normalize(value) {
    return String(value || '').toLocaleLowerCase('my').trim();
  }

  function setInvalid(control, message, errorNode, wrapper) {
    if (control) {
      control.classList.add('is-invalid');
      control.setAttribute('aria-invalid', 'true');
    }
    if (wrapper) wrapper.classList.add('is-invalid');
    if (errorNode) {
      errorNode.textContent = message;
      errorNode.hidden = false;
    }
  }

  function clearInvalid(control, errorNode, wrapper) {
    if (control) {
      control.classList.remove('is-invalid');
      control.removeAttribute('aria-invalid');
    }
    if (wrapper) wrapper.classList.remove('is-invalid');
    if (errorNode) {
      errorNode.textContent = '';
      errorNode.hidden = true;
    }
  }

  function isQuestionComplete(question) {
    const checked = question.querySelector('input[type="radio"]:checked');
    if (!checked) return false;
    if (checked.value === '0') return true;
    const count = question.querySelector('input[type="number"]');
    const description = question.querySelector('textarea');
    return Boolean(
      count &&
        description &&
        count.value.trim() !== '' &&
        description.value.trim() !== ''
    );
  }

  // 'complete' | 'incomplete' (ရှိ but missing count/description) | 'unanswered'
  function questionState(question) {
    const checked = question.querySelector('input[type="radio"]:checked');
    if (!checked) return 'unanswered';
    return isQuestionComplete(question) ? 'complete' : 'incomplete';
  }

  function firstUnansweredQuestion(group) {
    return (
      Array.from(group.querySelectorAll('[data-survey-question]')).find(
        function (question) {
          return !isQuestionComplete(question);
        }
      ) || null
    );
  }

  function initCombobox(root) {
    const input = root.querySelector('[data-combobox-input]');
    const hidden = root.querySelector('[data-combobox-value]');
    const menu = root.querySelector('[data-combobox-menu]');
    const toggle = root.querySelector('[data-combobox-toggle]');
    const empty = root.querySelector('[data-combobox-empty]');
    const error = root.querySelector('[data-combobox-error]');
    if (!input || !hidden || !menu) return null;

    const options = Array.from(menu.querySelectorAll('[role="option"]'));
    const label = root.dataset.comboboxLabel || 'တန်ဖိုး';
    let activeIndex = -1;

    function visibleOptions() {
      return options.filter(function (option) {
        return !option.hidden;
      });
    }

    function selectedOption() {
      return options.find(function (option) {
        return option.dataset.value === hidden.value;
      });
    }

    function setActive(index) {
      const visible = visibleOptions();
      options.forEach(function (option) {
        option.classList.remove('is-active');
      });
      activeIndex = index;
      const option = visible[activeIndex];
      if (!option) {
        input.removeAttribute('aria-activedescendant');
        return;
      }
      option.classList.add('is-active');
      input.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    }

    function filter(query) {
      const needle = normalize(query);
      let count = 0;
      options.forEach(function (option) {
        const match = normalize(option.dataset.label).includes(needle);
        option.hidden = !match;
        if (match) count += 1;
      });
      if (empty) empty.hidden = count !== 0;
      setActive(count ? 0 : -1);
      return count;
    }

    function openMenu(query) {
      menu.hidden = false;
      root.classList.add('is-open');
      input.setAttribute('aria-expanded', 'true');
      filter(query);
    }

    function closeMenu() {
      menu.hidden = true;
      root.classList.remove('is-open');
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      if (empty) empty.hidden = true;
      activeIndex = -1;
    }

    function clearSelection() {
      hidden.value = '';
      options.forEach(function (option) {
        option.setAttribute('aria-selected', 'false');
      });
    }

    function clearError() {
      root.classList.remove('is-invalid');
      input.removeAttribute('aria-invalid');
      if (error) {
        error.textContent = '';
        error.hidden = true;
      }
    }

    function validate() {
      const selected = selectedOption();
      const valid =
        Boolean(selected) &&
        input.value.trim() === selected.dataset.label.trim();

      closeMenu();
      if (valid) {
        clearError();
        return true;
      }

      if (selected) clearSelection();
      const message = input.value.trim()
        ? label +
          ' စာရင်းတွင် မပါဝင်ပါ။ စာရင်းမှ ရွေးချယ်ပါ။'
        : label + ' ကို စာရင်းမှ ရွေးချယ်ပါ။';
      root.classList.add('is-invalid');
      input.setAttribute('aria-invalid', 'true');
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
      return false;
    }

    function selectOption(option) {
      hidden.value = option.dataset.value;
      input.value = option.dataset.label;
      options.forEach(function (item) {
        item.setAttribute('aria-selected', String(item === option));
      });
      clearError();
      closeMenu();
      input.focus();
    }

    function openForBrowsing() {
      const selected = selectedOption();
      openMenu(
        selected && input.value === selected.dataset.label ? '' : input.value
      );
    }

    input.addEventListener('click', function () {
      if (menu.hidden) openForBrowsing();
    });

    input.addEventListener('input', function () {
      const selected = selectedOption();
      if (selected && input.value !== selected.dataset.label) {
        clearSelection();
      }
      clearError();
      openMenu(input.value);
    });

    input.addEventListener('keydown', function (event) {
      const visible = visibleOptions();
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (menu.hidden) {
          openForBrowsing();
          return;
        }
        setActive(Math.min(activeIndex + 1, visible.length - 1));
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (menu.hidden) {
          openForBrowsing();
          return;
        }
        setActive(Math.max(activeIndex - 1, 0));
      } else if (event.key === 'Home' && !menu.hidden) {
        event.preventDefault();
        setActive(0);
      } else if (event.key === 'End' && !menu.hidden) {
        event.preventDefault();
        setActive(visible.length - 1);
      } else if (event.key === 'Enter' && !menu.hidden && activeIndex >= 0) {
        event.preventDefault();
        selectOption(visible[activeIndex]);
      } else if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault();
        const selected = selectedOption();
        if (selected) input.value = selected.dataset.label;
        closeMenu();
      } else if (event.key === 'Tab') {
        closeMenu();
      }
    });

    if (toggle) {
      toggle.addEventListener('click', function () {
        if (menu.hidden) {
          openForBrowsing();
          input.focus();
        } else {
          closeMenu();
        }
      });
    }

    options.forEach(function (option) {
      option.addEventListener('click', function () {
        selectOption(option);
      });
    });

    document.addEventListener('click', function (event) {
      if (!root.contains(event.target)) closeMenu();
    });

    const selected = selectedOption();
    if (selected) {
      input.value = selected.dataset.label;
      selected.setAttribute('aria-selected', 'true');
    } else if (hidden.value) {
      clearSelection();
    }

    return {
      validate: validate,
      element: input,
    };
  }

  function initQuestion(question) {
    const details = question.querySelector('[data-question-details]');
    if (!details) return null;

    const fields = Array.from(details.querySelectorAll('input, textarea'));
    const radios = Array.from(question.querySelectorAll('input[type="radio"]'));
    const answerFieldset = question.querySelector('[data-answer-fieldset]');
    const radioError = question.querySelector('[data-radio-error]');
    const count = details.querySelector('input[type="number"]');
    const countError = question.querySelector('[data-count-error]');
    const description = details.querySelector('textarea');
    const descriptionError = question.querySelector('[data-description-error]');

    function autoGrowDescription() {
      if (!description || details.hidden) return;
      const minHeight = 200;
      const target = Math.max(minHeight, description.scrollHeight);
      if (target > description.offsetHeight) {
        description.style.height = target + 'px';
      }
    }

    function updateFields() {
      const checked = question.querySelector('input[type="radio"]:checked');
      const show = Boolean(checked && checked.value === '1');
      details.hidden = !show;
      fields.forEach(function (field) {
        field.disabled = !show;
      });
      if (!show) {
        clearInvalid(count, countError, count && count.closest('.uni-field'));
        clearInvalid(
          description,
          descriptionError,
          description && description.closest('.uni-field')
        );
      }
      autoGrowDescription();
    }

    function validateCount() {
      if (!count) return '';
      if (count.validity && count.validity.badInput) {
        return 'မှန်ကန်သော အရေအတွက် ဖြည့်ပါ။';
      }
      const raw = count.value.trim();
      if (!raw) return 'အရေအတွက် ဖြည့်ပါ။';
      if (!/^\d+$/.test(raw)) {
        return 'မှန်ကန်သော အရေအတွက် ဖြည့်ပါ။';
      }
      if (Number(raw) > 2147483647) {
        return 'အရေအတွက် ပမာဏ များလွန်းနေပါသည်။';
      }
      return '';
    }

    function validateDescription() {
      if (!description) return '';
      if (!description.value.trim()) return 'အကြောင်းအရာ ဖြည့်ပါ။';
      if (description.value.length > 4000) {
        return 'အကြောင်းအရာသည် စာလုံး ၄၀၀၀ လုံးထက် မကျော်ရပါ။';
      }
      return '';
    }

    function validate() {
      let firstInvalid = null;
      const checked = question.querySelector('input[type="radio"]:checked');

      clearInvalid(null, radioError);
      if (answerFieldset) answerFieldset.removeAttribute('aria-invalid');
      if (!checked) {
        setInvalid(
          null,
          'ရှိ / မရှိ တစ်ခုရွေးချယ်ပေးပါ။',
          radioError
        );
        if (answerFieldset) {
          answerFieldset.setAttribute('aria-invalid', 'true');
        }
        firstInvalid = radios[0] || null;
      }

      if (checked && checked.value === '1') {
        const countMessage = validateCount();
        if (countMessage) {
          setInvalid(
            count,
            countMessage,
            countError,
            count && count.closest('.uni-field')
          );
          if (!firstInvalid) firstInvalid = count;
        } else {
          clearInvalid(count, countError, count && count.closest('.uni-field'));
        }

        const descriptionMessage = validateDescription();
        if (descriptionMessage) {
          setInvalid(
            description,
            descriptionMessage,
            descriptionError,
            description && description.closest('.uni-field')
          );
          if (!firstInvalid) firstInvalid = description;
        } else {
          clearInvalid(
            description,
            descriptionError,
            description && description.closest('.uni-field')
          );
        }
      } else {
        clearInvalid(count, countError, count && count.closest('.uni-field'));
        clearInvalid(
          description,
          descriptionError,
          description && description.closest('.uni-field')
        );
      }

      return firstInvalid;
    }

    radios.forEach(function (radio) {
      radio.addEventListener('change', function () {
        clearInvalid(null, radioError);
        if (answerFieldset) answerFieldset.removeAttribute('aria-invalid');
        updateFields();
        if (radio.value === '1' && radio.checked && count) {
          count.focus();
        }
      });
    });

    if (count) {
      count.addEventListener('input', function () {
        clearInvalid(count, countError, count.closest('.uni-field'));
      });
    }

    if (description) {
      description.addEventListener('input', function () {
        clearInvalid(
          description,
          descriptionError,
          description.closest('.uni-field')
        );
        autoGrowDescription();
      });
    }

    updateFields();
    return {
      element: question,
      validate: validate,
      updateFields: updateFields,
    };
  }

  function initProgress(form, wizard) {
    const questions = Array.from(
      form.querySelectorAll('[data-survey-question]')
    );
    const groups = Array.from(form.querySelectorAll('[data-survey-group]'));
    const total = questions.length;
    const groupStats = new Map();

    const overallPercent = document.querySelector('[data-overall-percent]');
    const overallBar = document.querySelector('[data-overall-bar]');
    const overallTrack = document.querySelector('[data-overall-track]');
    const overallCompleted = document.querySelector('[data-overall-completed]');
    const overallRemaining = document.querySelector('[data-overall-remaining]');
    const navSummary = document.querySelector('[data-nav-summary]');
    const submitProgress = document.querySelector('[data-submit-progress]');
    const submitTrack = document.querySelector('[data-submit-track]');
    const submitFill = document.querySelector('[data-submit-fill]');
    const submitRemaining = document.querySelector('[data-submit-remaining]');
    const submitLabel = document.querySelector('[data-submit-label]');

    const sectionDone = document.querySelector('[data-section-progress-done]');
    const sectionTotal = document.querySelector('[data-section-progress-total]');
    const sectionBar = document.querySelector('[data-section-progress-bar]');
    const sectionTrack = document.querySelector(
      '[data-section-progress-track]'
    );
    const sectionPercent = document.querySelector(
      '[data-section-progress-percent]'
    );
    const sectionRemaining = document.querySelector(
      '[data-section-progress-remaining]'
    );

    function currentKey() {
      return wizard ? wizard.currentKey() : '';
    }

    function collect() {
      groupStats.clear();
      let completed = 0;

      questions.forEach(function (question) {
        const state = questionState(question);
        question.classList.toggle('is-complete', state === 'complete');
        question.classList.toggle('is-incomplete', state === 'incomplete');

        const chip = question.querySelector('[data-question-status]');
        const chipText = question.querySelector('[data-question-status-text]');
        if (chip && chipText) {
          if (state === 'complete') {
            chipText.textContent = 'ဖြေဆိုပြီး';
            chip.hidden = false;
          } else if (state === 'incomplete') {
            chipText.textContent = 'မပြည့်စုံပါ';
            chip.hidden = false;
          } else {
            chip.hidden = true;
          }
        }

        if (state === 'complete') completed += 1;

        const group = question.closest('[data-survey-group]');
        if (!group) return;
        const key = String(group.dataset.surveyGroup);
        const entry = groupStats.get(key) || { done: 0, total: 0, touched: 0 };
        entry.total += 1;
        if (state === 'complete') entry.done += 1;
        if (state !== 'unanswered') entry.touched += 1;
        groupStats.set(key, entry);
      });

      return completed;
    }

    function paintGroup(key) {
      const entry = groupStats.get(key) || { done: 0, total: 0, touched: 0 };
      const remaining = entry.total - entry.done;
      const complete = entry.total > 0 && remaining === 0;
      const started = entry.touched > 0;
      const stateLabel = complete
        ? 'ပြီးစီး'
        : started
          ? 'လုပ်ဆောင်နေဆဲ'
          : 'မစတင်ရသေး';

      document
        .querySelectorAll('[data-group-count]')
        .forEach(function (node) {
          if (node.dataset.groupCount === key) {
            node.textContent =
              String(entry.done) + ' / ' + String(entry.total) + ' မေးခွန်း';
          }
        });

      document.querySelectorAll('[data-group-card]').forEach(function (card) {
        if (card.dataset.groupCard !== key) return;
        card.classList.toggle('is-complete', complete);
        const icon = card.querySelector('[data-group-icon]');
        const state = card.querySelector('[data-group-state]');
        if (icon && complete) icon.textContent = '✓';
        if (state) state.textContent = stateLabel;
      });

      document
        .querySelectorAll('[data-section-item]')
        .forEach(function (item) {
          if (item.dataset.sectionItem !== key) return;
          item.classList.toggle('is-complete', complete);
          item.classList.toggle('is-in-progress', !complete && started);
          item.classList.toggle('is-pending', !complete && !started);
          const count = item.querySelector('[data-section-count]');
          const rem = item.querySelector('[data-section-remaining]');
          const stateNode = item.querySelector('[data-section-state]');
          const icon = item.querySelector('[data-section-icon]');
          if (count) {
            count.textContent =
              String(entry.done) + ' / ' + String(entry.total) + ' မေးခွန်း';
          }
          if (rem) {
            rem.hidden = complete;
            rem.textContent = String(remaining) + ' ခု ကျန်ရှိ';
          }
          if (stateNode) stateNode.textContent = stateLabel;
          if (icon) {
            icon.textContent = complete
              ? '✓'
              : String(item.dataset.sectionIndex || '');
          }
        });

      return entry;
    }

    function paintSectionProgress(key) {
      if (!key) return;
      const entry = groupStats.get(String(key)) || { done: 0, total: 0 };
      const remaining = entry.total - entry.done;
      const percent = entry.total
        ? Math.round((entry.done / entry.total) * 100)
        : 0;

      if (sectionDone) sectionDone.textContent = String(entry.done);
      if (sectionTotal) sectionTotal.textContent = String(entry.total);
      if (sectionBar) sectionBar.style.width = percent + '%';
      if (sectionTrack) sectionTrack.setAttribute('aria-valuenow', String(percent));
      if (sectionPercent) sectionPercent.textContent = percent + '%';
      if (sectionRemaining) {
        sectionRemaining.textContent = remaining
          ? String(remaining) + ' ခု ကျန်ရှိ'
          : 'အားလုံး ဖြေဆိုပြီး';
      }
    }

    function update() {
      const completed = collect();
      const remaining = total - completed;
      const percent = total ? Math.round((completed / total) * 100) : 0;
      const allComplete = total > 0 && remaining === 0;

      groups.forEach(function (group) {
        paintGroup(String(group.dataset.surveyGroup));
      });

      if (overallPercent) overallPercent.textContent = percent + '%';
      if (overallBar) overallBar.style.width = percent + '%';
      if (overallTrack) {
        overallTrack.setAttribute('aria-valuenow', String(percent));
      }
      if (overallCompleted) {
        overallCompleted.innerHTML =
          String(completed) + ' <small>မေးခွန်း</small>';
      }
      if (overallRemaining) {
        overallRemaining.innerHTML =
          String(remaining) + ' <small>မေးခွန်း</small>';
      }
      if (navSummary) {
        navSummary.textContent = String(completed) + ' / ' + String(total);
      }
      if (submitProgress) {
        submitProgress.textContent =
          String(completed) + ' / ' + String(total);
      }
      if (submitFill) {
        submitFill.style.width = percent + '%';
        submitFill.classList.toggle('is-complete', allComplete);
      }
      if (submitTrack) {
        submitTrack.setAttribute('aria-valuenow', String(percent));
      }
      if (submitRemaining) {
        submitRemaining.textContent = remaining
          ? String(remaining) + ' ခု ကျန်ရှိ'
          : 'အားလုံး ပြီးစီး';
        submitRemaining.classList.toggle('is-complete', allComplete);
      }
      if (submitLabel) {
        submitLabel.textContent = allComplete
          ? 'အဖြေများ ပေးပို့ရန်'
          : 'အဖြေများ ပေးပို့ရန်';
      }

      paintSectionProgress(currentKey());
    }

    form.addEventListener('change', update);
    form.addEventListener('input', update);
    form.addEventListener('survey:group-change', function (event) {
      paintSectionProgress(event.detail.key);
    });
    update();
  }

  function initGroupWizard(form) {
    const groups = Array.from(form.querySelectorAll('[data-survey-group]'));
    if (!groups.length) return null;

    const overview = form.querySelector('[data-overview]');
    const stage = form.querySelector('[data-answer-stage]');
    const stageTitle = form.querySelector('[data-stage-title]');
    const stageKicker = form.querySelector('[data-stage-kicker]');
    const overviewTitle = form.querySelector('[data-overview-title]');
    const openButtons = Array.from(document.querySelectorAll('[data-open-group]'));
    const sectionItems = Array.from(
      document.querySelectorAll('[data-section-item]')
    );
    const startButton = form.querySelector('[data-start-survey]');
    const submitBar = form.querySelector('[data-submit-bar]');
    const closeButton = form.querySelector('[data-close-stage]');
    const prevButtons = Array.from(form.querySelectorAll('[data-prev-group]'));
    const nextButtons = Array.from(form.querySelectorAll('[data-next-group]'));
    const groupIndex = new Map();
    const groupByKey = new Map();
    let currentIndex = -1;

    groups.forEach(function (group, index) {
      const key = String(group.dataset.surveyGroup);
      groupIndex.set(key, index);
      groupByKey.set(key, group);
    });

    function currentKey() {
      return currentIndex >= 0 && groups[currentIndex]
        ? String(groups[currentIndex].dataset.surveyGroup)
        : '';
    }

    function emitGroupChange() {
      form.dispatchEvent(
        new CustomEvent('survey:group-change', {
          detail: { key: currentKey() },
        })
      );
    }

    function syncNavigation() {
      const activeKey = currentKey();
      sectionItems.forEach(function (item) {
        const isCurrent = String(item.dataset.sectionItem) === activeKey;
        item.classList.toggle('is-current', isCurrent);
        if (isCurrent) {
          item.setAttribute('aria-current', 'step');
        } else {
          item.removeAttribute('aria-current');
        }
      });
      prevButtons.forEach(function (button) {
        button.disabled = currentIndex <= 0;
      });
      nextButtons.forEach(function (button) {
        button.disabled =
          currentIndex < 0 || currentIndex >= groups.length - 1;
      });
      if (submitBar) {
        submitBar.hidden = currentIndex < 0;
      }
      emitGroupChange();
    }

    function showOverview(shouldFocus) {
      currentIndex = -1;
      groups.forEach(function (group) {
        group.hidden = true;
      });
      if (stage) stage.hidden = true;
      if (overview) overview.hidden = false;
      if (stageTitle) stageTitle.textContent = '';
      if (stageKicker) stageKicker.textContent = '';
      syncNavigation();

      if (shouldFocus && overviewTitle) {
        const reduceMotion = window.matchMedia(
          '(prefers-reduced-motion: reduce)'
        ).matches;
        window.requestAnimationFrame(function () {
          overviewTitle.focus({ preventScroll: true });
          overviewTitle.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block: 'start',
          });
        });
      }
    }

    function openIndex(index, options) {
      if (index < 0 || index >= groups.length) return;
      const settings = options || {};
      const group = groups[index];
      currentIndex = index;

      groups.forEach(function (item) {
        item.hidden = item !== group;
      });
      if (overview) overview.hidden = true;
      if (stage) stage.hidden = false;
      if (stageTitle) {
        stageTitle.textContent = group.dataset.groupTitle || '';
      }
      if (stageKicker) {
        stageKicker.textContent =
          'မေးခွန်း အပိုင်း ' + String(index + 1) + ' / ' + String(groups.length);
      }
      syncNavigation();

      const focusTarget = settings.focus || null;
      if (!focusTarget && settings.focusTitle === false) return;

      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      window.requestAnimationFrame(function () {
        if (focusTarget) {
          const field = focusTarget.querySelector('input[type="radio"]');
          (field || focusTarget).focus({ preventScroll: true });
          focusTarget.scrollIntoView({
            behavior: reduceMotion ? 'auto' : 'smooth',
            block: 'center',
          });
          return;
        }
        if (stageTitle) {
          stageTitle.focus({ preventScroll: true });
          if (stage) {
            stage.scrollIntoView({
              behavior: reduceMotion ? 'auto' : 'smooth',
              block: 'start',
            });
          }
        }
      });
    }

    function openKey(key, options) {
      const index = groupIndex.get(String(key));
      if (index === undefined) return;
      openIndex(index, options);
    }

    openButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        const key = String(button.dataset.openGroup);
        const group = groupByKey.get(key);
        const unanswered = group ? firstUnansweredQuestion(group) : null;
        if (unanswered) {
          openKey(key, { focus: unanswered });
          return;
        }
        openKey(key);
      });
    });

    if (startButton) {
      startButton.addEventListener('click', function () {
        const unanswered = groups
          .map(function (group) {
            return firstUnansweredQuestion(group);
          })
          .find(Boolean);
        if (unanswered) {
          const group = unanswered.closest('[data-survey-group]');
          if (group) {
            openKey(group.dataset.surveyGroup, { focus: unanswered });
            return;
          }
        }
        openIndex(0);
      });
    }

    if (closeButton) {
      closeButton.addEventListener('click', function () {
        showOverview(true);
      });
    }

    prevButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        if (currentIndex > 0) openIndex(currentIndex - 1);
      });
    });

    nextButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        if (currentIndex >= 0 && currentIndex < groups.length - 1) {
          openIndex(currentIndex + 1);
        }
      });
    });

    function groupForQuestion(question) {
      const group = question.closest('[data-survey-group]');
      return group ? String(group.dataset.surveyGroup) : '';
    }

    const firstServerError = form.querySelector(
      '[data-survey-question][data-has-error]'
    );
    const identityInvalid = document.querySelector(
      '[data-combobox].is-invalid'
    );
    if (!identityInvalid && firstServerError) {
      const key = groupForQuestion(firstServerError);
      if (key) openKey(key, { focusTitle: false });
    } else if (!identityInvalid && window.location.hash) {
      const targetId = window.location.hash.slice(1);
      const target = groups.find(function (group) {
        return group.id === targetId;
      });
      if (target) {
        openKey(target.dataset.surveyGroup, { focusTitle: false });
      }
    }

    return {
      openKey: openKey,
      showOverview: showOverview,
      groupForQuestion: groupForQuestion,
      currentKey: currentKey,
    };
  }

  function init() {
    const comboboxes = Array.from(
      document.querySelectorAll('[data-combobox]')
    )
      .map(initCombobox)
      .filter(Boolean);

    const form = document.querySelector('[data-public-survey]');
    if (!form) return;

    const errorDialog = form.querySelector('[data-survey-error-dialog]');
    const errorMessage = form.querySelector('[data-survey-error-message]');
    const errorList = form.querySelector('[data-survey-error-list]');
    const errorClose = form.querySelector('[data-survey-error-close]');

    function focusElement(target) {
      if (!target) return;
      const reduceMotion = window.matchMedia(
        '(prefers-reduced-motion: reduce)'
      ).matches;
      window.requestAnimationFrame(function () {
        target.focus({ preventScroll: true });
        target.scrollIntoView({
          behavior: reduceMotion ? 'auto' : 'smooth',
          block: 'center',
        });
      });
    }

    function showSurveyError(groups, identityInvalid) {
      if (!errorDialog) return;

      if (errorMessage) {
        errorMessage.textContent = identityInvalid
          ? 'စာရင်းမှ သင့်အဖွဲ့အစည်းကို ရွေးချယ်ပြီး မေးခွန်းအားလုံးကို ဖြေဆိုပါ။'
          : 'မေးခွန်းအားလုံးကို ဖြေဆိုပြီးမှ ထပ်မံပေးပို့ပါ။';
      }

      if (errorList) {
        errorList.textContent = '';
        groups.forEach(function (title) {
          const item = document.createElement('li');
          item.textContent = title;
          errorList.appendChild(item);
        });
        errorList.hidden = groups.length === 0;
      }

      if (typeof errorDialog.showModal === 'function') {
        if (!errorDialog.open) errorDialog.showModal();
      } else {
        errorDialog.setAttribute('open', '');
      }
    }

    if (errorDialog) {
      if (errorClose) {
        errorClose.addEventListener('click', function () {
          if (typeof errorDialog.close === 'function') {
            errorDialog.close();
          } else {
            errorDialog.removeAttribute('open');
          }
        });
      }

      errorDialog.addEventListener('click', function (event) {
        if (event.target !== errorDialog) return;
        const bounds = errorDialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          if (typeof errorDialog.close === 'function') {
            errorDialog.close();
          } else {
            errorDialog.removeAttribute('open');
          }
        }
      });
    }

    const questions = Array.from(
      form.querySelectorAll('[data-survey-question]')
    )
      .map(initQuestion)
      .filter(Boolean);

    const wizard = initGroupWizard(form);
    initProgress(form, wizard);

    form.addEventListener('submit', function (event) {
      let firstInvalid = null;
      let firstInvalidQuestion = null;
      let identityInvalid = false;
      const invalidQuestions = [];

      comboboxes.forEach(function (combobox) {
        if (combobox.validate()) return;
        identityInvalid = true;
        if (!firstInvalid) firstInvalid = combobox.element;
      });

      questions.forEach(function (item) {
        const invalid = item.validate();
        if (!invalid) return;
        invalidQuestions.push(item.element);
        if (!firstInvalid) {
          firstInvalid = invalid;
          firstInvalidQuestion = item.element;
        }
      });

      if (!firstInvalid) return;

      event.preventDefault();

      const errorGroups = [];
      invalidQuestions.forEach(function (question) {
        const group = question.closest('[data-survey-group]');
        if (!group) return;
        const title = group.dataset.groupTitle || '';
        const numberNode = question.querySelector('.uni-question__number');
        const number = numberNode ? numberNode.textContent.trim() : '';
        let entry = errorGroups.find(function (item) {
          return item.title === title;
        });
        if (!entry) {
          entry = { title: title, numbers: [] };
          errorGroups.push(entry);
        }
        if (number) entry.numbers.push(number);
      });

      if (firstInvalidQuestion && wizard) {
        const key = wizard.groupForQuestion(firstInvalidQuestion);
        if (key) wizard.openKey(key, { focusTitle: false });
      } else if (wizard) {
        wizard.showOverview();
      }

      const errorLabels = errorGroups.map(function (entry) {
        if (!entry.numbers.length) return entry.title;
        return (
          entry.title + ' — မေးခွန်း ' + entry.numbers.join(', ')
        );
      });

      if (errorDialog) {
        errorDialog.addEventListener(
          'close',
          function () {
            if (firstInvalidQuestion && wizard) {
              const key = wizard.groupForQuestion(firstInvalidQuestion);
              if (key) {
                wizard.openKey(key, { focus: firstInvalid });
                return;
              }
            }
            if (wizard) wizard.showOverview();
            focusElement(firstInvalid);
          },
          { once: true }
        );
        showSurveyError(errorLabels, identityInvalid);
        return;
      }

      if (firstInvalidQuestion && wizard) {
        const key = wizard.groupForQuestion(firstInvalidQuestion);
        if (key) {
          wizard.openKey(key, { focus: firstInvalid });
          return;
        }
      }

      if (wizard) wizard.showOverview();
      focusElement(firstInvalid);
    });

    let dirty = false;
    form.addEventListener('input', function () {
      dirty = true;
    });
    form.addEventListener('change', function () {
      dirty = true;
    });
    form.addEventListener('submit', function (event) {
      window.setTimeout(function () {
        if (!event.defaultPrevented) dirty = false;
      }, 0);
    });
    window.addEventListener('beforeunload', function (event) {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
